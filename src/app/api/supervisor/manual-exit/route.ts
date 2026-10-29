import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { lockRfid, rfidApiError } from "@/lib/rfid-access";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import { manualExitTarget, completeManualExit } from "@/lib/manual-exit";
async function handlePOST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !(user.role === "SUPER_ADMIN" || user.role === "BUILDING_ADMIN" && hasPermission(user, "building.approveManualExit") || user.role === "EMPLOYEE" && hasPermission(user, "supervisor.liveDashboard") && hasPermission(user, "supervisor.requestManualExit"))) throw new ParkingError("Manual exit is not available for this account.", 403);
    const body = await request.json(); const [kind, id] = String(body.id || "").split(":");
    if (!id) throw new ParkingError("Invalid active-card selection.");
    const result = await prisma.$transaction(async tx => {
      await lockRfid(tx);
      const target = await manualExitTarget(tx, kind, id);
      if (user.role !== "SUPER_ADMIN" && target.buildingId !== user.buildingId) throw new ParkingError("This vehicle is outside your assigned building.", 403);
      if (user.role === "SUPER_ADMIN" && !isPrimarySuperAdmin(user) && !await tx.building.findFirst({ where: { id: target.buildingId, superAdminId: user.id }, select: { id: true } })) throw new ParkingError("This building is not assigned to your account.", 403);
      await lockBuildingParking(tx, target.buildingId);
      if (!target.isInside) throw new ParkingError("This vehicle is already outside.", 409);
      if (user.role === "EMPLOYEE") {
        let existing = await tx.manualExitNotification.findFirst({ where: { buildingId: target.buildingId, targetKind: kind, targetId: id, targetAccessAt: target.lastAccessAt, status: "PENDING" } });
        if (existing && existing.targetAccessAt?.getTime() !== target.lastAccessAt?.getTime()) {
          await tx.manualExitNotification.update({ where: { id: existing.id }, data: { status: "CLOSED" } });
          existing = null;
        }
        if (!existing) {
          const building = await tx.building.findUniqueOrThrow({ where: { id: target.buildingId }, select: { name: true } });
          await tx.manualExitNotification.create({ data: { buildingId: target.buildingId, buildingName: building.name,
            targetKind: kind, targetId: id, targetAccessAt: target.lastAccessAt, actorId: user.id, actorName: `${user.username} (${user.userId})`,
            vehicleNumber: target.vehicleNumber, personName: target.personName, cardNo: target.cardNo } });
        }
        return { requested: true, message: existing ? "Manual exit approval is already pending." : "Manual exit requested. The vehicle remains on site until Admin or Super Admin approves." };
      }
      await completeManualExit(tx, target, user.role === "BUILDING_ADMIN" ? "Manual exit by admin" : "Manual exit by super admin");
      return { requested: false, message: "Manual exit completed." };
    }, { maxWait: 10000, timeout: 20000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return rfidApiError(error); }
}

export const POST = withAuditRequest(handlePOST);
