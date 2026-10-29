import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

async function handlePOST(
  _request: Request,
  context: { params: Promise<{ buildingId: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) {
    return NextResponse.json({ ok: false, message: "Super Admin or Building Admin access required." }, { status: 403 });
  }
  if (user.role === "BUILDING_ADMIN" && !hasPermission(user, "building.configureGates")) {
    return NextResponse.json({ ok: false, message: "Gate and reader configuration is not assigned to this Admin account." }, { status: 403 });
  }

  const { buildingId } = await context.params;
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    select: { id: true, maximumGate: true, superAdminId: true },
  });
  if (!building) {
    return NextResponse.json({ ok: false, message: "Building not found." }, { status: 404 });
  }

  const allowed = user.role === "BUILDING_ADMIN"
    ? user.buildingId === buildingId
    : isPrimarySuperAdmin(user) || building.superAdminId === user.id;
  if (!allowed) {
    return NextResponse.json({ ok: false, message: "You do not have permission to add a gate for this building." }, { status: 403 });
  }

  const existing = await prisma.gate.findMany({
    where: { buildingId },
    select: { gateNumber: true },
    orderBy: { gateNumber: "asc" },
  });
  const used = new Set(existing.map((gate) => gate.gateNumber));
  let gateNumber = 1;
  while (gateNumber <= building.maximumGate && used.has(gateNumber)) gateNumber += 1;

  if (gateNumber > building.maximumGate) {
    return NextResponse.json({ ok: false, message: `Maximum Gate limit reached (${building.maximumGate}).` }, { status: 409 });
  }

  const gate = await prisma.gate.create({
    data: { buildingId, gateNumber, direction: "SELECT" },
    select: { id: true, buildingId: true, gateNumber: true, direction: true },
  });

  revalidatePath("/access-control/gate-details");
  return NextResponse.json({ ok: true, message: `Gate ${gateNumber} added.`, gate }, { status: 201 });
}

export const POST = withAuditRequest(handlePOST);
