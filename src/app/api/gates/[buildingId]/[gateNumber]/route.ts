import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import { isGateDirection, parseGateConfig, serializeGateConfig } from "@/lib/gate-config";

async function getAuthorizedBuilding(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, buildingId: string) {
  if (user.role === "BUILDING_ADMIN" && !hasPermission(user, "building.configureGates")) {
    return { error: NextResponse.json({ ok: false, message: "Gate and reader configuration is not assigned to this Admin account." }, { status: 403 }) };
  }
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    select: { id: true, maximumGate: true, superAdminId: true },
  });
  if (!building) return { error: NextResponse.json({ ok: false, message: "Building not found." }, { status: 404 }) };

  const allowed = user.role === "BUILDING_ADMIN"
    ? user.buildingId === buildingId
    : user.role === "SUPER_ADMIN" && (isPrimarySuperAdmin(user) || building.superAdminId === user.id);

  if (!allowed) return { error: NextResponse.json({ ok: false, message: "You do not have permission to update this building gate." }, { status: 403 }) };
  return { building };
}

async function validateReader(buildingId: string, readerId: string | null, label: "Entry" | "Exit") {
  if (!readerId) return null;
  const reader = await prisma.rfidReader.findUnique({ where: { id: readerId }, select: { id: true, buildingId: true, enabled: true, mode: true } });
  if (!reader || reader.buildingId !== buildingId) return `${label} reader must be assigned to this building.`;
  if (!reader.enabled) return `${label} reader is disabled and cannot be allotted to a gate.`;
  if (reader.mode === "REGISTER") return `A Registration reader cannot be used as the ${label.toLowerCase()} reader.`;
  if (reader.mode === "UNASSIGNED") return `${label} reader purpose has not been configured by the Building Admin.`;
  return null;
}

async function handlePATCH(request: Request, context: { params: Promise<{ buildingId: string; gateNumber: string }> }) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) {
    return NextResponse.json({ ok: false, message: "Super Admin or Building Admin access required." }, { status: 403 });
  }

  const { buildingId, gateNumber: gateNumberText } = await context.params;
  const gateNumber = Number(gateNumberText);
  if (!Number.isInteger(gateNumber) || gateNumber < 1) return NextResponse.json({ ok: false, message: "Invalid gate number." }, { status: 400 });

  const auth = await getAuthorizedBuilding(user, buildingId);
  if (auth.error) return auth.error;
  const building = auth.building!;
  if (gateNumber > building.maximumGate) return NextResponse.json({ ok: false, message: `This building supports a maximum of ${building.maximumGate} gate${building.maximumGate === 1 ? "" : "s"}.` }, { status: 400 });

  const body = await request.json().catch(() => null);
  const existingGate = await prisma.gate.findUnique({ where: { buildingId_gateNumber: { buildingId, gateNumber } }, select: { direction: true } });
  const current = parseGateConfig(existingGate?.direction);
  const direction = body && Object.prototype.hasOwnProperty.call(body, "direction") ? String(body.direction ?? "") : current.direction;
  if (!isGateDirection(direction)) return NextResponse.json({ ok: false, message: "Select Entry, Exit, Entry & Exit, or Select." }, { status: 400 });

  let entryReaderId = body && Object.prototype.hasOwnProperty.call(body, "entryReaderId") ? String(body.entryReaderId ?? "").trim() || null : current.entryReaderId;
  let exitReaderId = body && Object.prototype.hasOwnProperty.call(body, "exitReaderId") ? String(body.exitReaderId ?? "").trim() || null : current.exitReaderId;

  if (body && Object.prototype.hasOwnProperty.call(body, "readerId")) {
    const legacyReaderId = String(body.readerId ?? "").trim() || null;
    if (direction === "EXIT") exitReaderId = legacyReaderId;
    else entryReaderId = legacyReaderId;
  }

  if (direction === "SELECT") { entryReaderId = null; exitReaderId = null; }
  else if (direction === "ENTRY") exitReaderId = null;
  else if (direction === "EXIT") entryReaderId = null;


  const entryError = await validateReader(buildingId, entryReaderId, "Entry");
  if (entryError) return NextResponse.json({ ok: false, message: entryError }, { status: 400 });
  const exitError = await validateReader(buildingId, exitReaderId, "Exit");
  if (exitError) return NextResponse.json({ ok: false, message: exitError }, { status: 400 });

  const allGates = await prisma.gate.findMany({
    where: { buildingId },
    select: { buildingId: true, gateNumber: true, direction: true },
  });
  const requestedReaderIds = [entryReaderId, exitReaderId].filter((id): id is string => Boolean(id));
  for (const readerId of requestedReaderIds) {
    const usedElsewhere = allGates.find((gate) => {
      if (gate.buildingId === buildingId && gate.gateNumber === gateNumber) return false;
      const config = parseGateConfig(gate.direction);
      return config.entryReaderId === readerId || config.exitReaderId === readerId;
    });
    if (usedElsewhere) return NextResponse.json({ ok: false, message: "This reader is already assigned to another gate in this building. Remove that gate assignment first." }, { status: 409 });
  }

  const storedDirection = serializeGateConfig(direction, entryReaderId, exitReaderId);
  const gate = await prisma.gate.upsert({
    where: { buildingId_gateNumber: { buildingId, gateNumber } },
    create: { buildingId, gateNumber, direction: storedDirection },
    update: { direction: storedDirection },
    select: { id: true, buildingId: true, gateNumber: true, direction: true, updatedAt: true },
  });

  revalidatePath("/access-control/gate-details");
  return NextResponse.json({ ok: true, message: requestedReaderIds.length ? `Gate ${gateNumber} reader allocation updated.` : `Gate ${gateNumber} updated successfully.`, gate: { ...gate, direction, entryReaderId, exitReaderId } });
}

async function handleDELETE(_request: Request, context: { params: Promise<{ buildingId: string; gateNumber: string }> }) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) {
    return NextResponse.json({ ok: false, message: "Super Admin or Building Admin access required." }, { status: 403 });
  }

  const { buildingId, gateNumber: gateNumberText } = await context.params;
  const gateNumber = Number(gateNumberText);
  if (!Number.isInteger(gateNumber) || gateNumber < 1) return NextResponse.json({ ok: false, message: "Invalid gate number." }, { status: 400 });

  const auth = await getAuthorizedBuilding(user, buildingId);
  if (auth.error) return auth.error;

  const gateCount = await prisma.gate.count({ where: { buildingId } });
  if (gateCount <= 1) return NextResponse.json({ ok: false, message: "At least one gate must remain. The Maximum Gate setting is not changed." }, { status: 409 });

  await prisma.gate.deleteMany({ where: { buildingId, gateNumber } });
  revalidatePath("/access-control/gate-details");
  return NextResponse.json({ ok: true, message: `Gate ${gateNumber} removed. Its reader allocation is now available again.` });
}

export const PATCH = withAuditRequest(handlePATCH);
export const DELETE = withAuditRequest(handleDELETE);
