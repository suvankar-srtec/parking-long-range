import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission, sanitizePermissions } from "@/lib/permissions";
import { nextSupervisorUserId } from "@/lib/supervisor-user-id";

async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: buildingId } = await context.params;
    const user = await getCurrentUser();
    if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) {
      return NextResponse.json({ ok: false, message: "Only Super Admin or Admin can manage a supervisor." }, { status: 403 });
    }
    if (user.role === "BUILDING_ADMIN" && (user.buildingId !== buildingId || !hasPermission(user, "building.manageSupervisor"))) {
      return NextResponse.json({ ok: false, message: "You do not have permission to manage this building's Supervisor." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const password = String(body?.password ?? "");
    const reservationId = String(body?.reservationId ?? "").trim();
    const permissions = sanitizePermissions("EMPLOYEE", body?.permissions);
    if (!password.trim()) {
      return NextResponse.json({ ok: false, message: "Supervisor password is required." }, { status: 400 });
    }

    const building = await prisma.building.findUnique({ where: { id: buildingId }, select: { id: true, name: true } });
    if (!building) return NextResponse.json({ ok: false, message: "Building not found." }, { status: 404 });

    const current = await prisma.user.findFirst({ where: { role: "EMPLOYEE", buildingId, companyId: null }, orderBy: { createdAt: "asc" } });
    let supervisor;

    if (current) {
      supervisor = await prisma.user.update({
        where: { id: current.id },
        data: { password, role: "EMPLOYEE", buildingId, companyId: null, permissions, permissionsCustomized: true },
        select: { id: true, userId: true, username: true, permissions: true, permissionsCustomized: true },
      });
    } else {
      if (!reservationId) {
        return NextResponse.json({ ok: false, message: "Generate the Supervisor User ID before saving." }, { status: 400 });
      }

      const userId = await nextSupervisorUserId();
      supervisor = await prisma.user.create({
        data: {
          userId,
          username: `${building.name} Supervisor`,
          password,
          role: "EMPLOYEE",
          buildingId,
          permissions,
          permissionsCustomized: true,
        },
        select: { id: true, userId: true, username: true, permissions: true, permissionsCustomized: true },
      });
    }

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/buildings/${buildingId}`);
    return NextResponse.json({ ok: true, message: `Supervisor account saved for ${building.name}. User ID: ${supervisor.userId}.`, supervisor });
  } catch (error) {
    console.error("SAVE_SUPERVISOR_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to save supervisor account." }, { status: 500 });
  }
}

export const POST = withAuditRequest(handlePOST);
