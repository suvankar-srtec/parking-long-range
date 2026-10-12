import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notificationContext } from "@/lib/manual-exit-notifications";
import { manualExitTarget, completeManualExit } from "@/lib/manual-exit";
import { lockRfid, rfidApiError } from "@/lib/rfid-access";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, where } = await notificationContext(); const { id } = await context.params;
    const result = await prisma.$transaction(async tx => {
      await lockRfid(tx);
      const notice = await tx.manualExitNotification.findFirst({ where: { ...where, id } });
      if (!notice) throw new ParkingError("Request not found.", 404);
      if (notice.status !== "PENDING") throw new ParkingError("This request has already been handled.", 409);
      const target = await manualExitTarget(tx, notice.targetKind, notice.targetId);
      if (target.buildingId !== notice.buildingId) throw new ParkingError("The vehicle's building changed.", 409);
      await lockBuildingParking(tx, target.buildingId);
      const sameVisit = notice.targetAccessAt?.getTime() === target.lastAccessAt?.getTime();
      const event = target.isInside && sameVisit ? await completeManualExit(tx, target, `Manual exit requested by ${notice.actorName}; approved by ${user.username} (${user.userId})`) : null;
      await tx.manualExitNotification.update({ where: { id }, data: { status: event ? "APPROVED" : "CLOSED", eventId: event?.id,
        approvedById: user.id, approvedByName: `${user.username} (${user.userId})`, approvedAt: new Date() } });
      await tx.manualExitNotificationRead.createMany({ data: [{ notificationId: id, userId: user.id }], skipDuplicates: true });
      return event ? "Manual exit approved. Vehicle removed from Currently on Site." : "Request closed: the original parking visit has ended.";
    }, { maxWait: 10000, timeout: 20000 });
    return NextResponse.json({ ok: true, message: result });
  } catch (error) { return rfidApiError(error); }
}
