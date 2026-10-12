import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notificationContext } from "@/lib/manual-exit-notifications";
import { rfidApiError } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";
export async function GET(request: Request) {
  try {
    const { user, where } = await notificationContext();
    const summary = new URL(request.url).searchParams.get("summary") === "1";
    const [unread, records] = await Promise.all([
      prisma.manualExitNotification.count({ where: { ...where, reads: { none: { userId: user.id } } } }),
      summary ? Promise.resolve([]) : prisma.manualExitNotification.findMany({ where, orderBy: [{ status: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 100,
        include: { reads: { where: { userId: user.id }, select: { readAt: true } } } }),
    ]);
    return NextResponse.json({ ok: true, unread, notifications: records.map(({ reads, ...record }) => ({ ...record, read: reads.length > 0 })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rfidApiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const { user, where } = await notificationContext();
    const body = await request.json();
    if (body.all !== true && typeof body.id !== "string") throw new ParkingError("Select a notification.");
    const records = await prisma.manualExitNotification.findMany({ where: { ...where, ...(body.all === true ? {} : { id: body.id }), reads: { none: { userId: user.id } } }, select: { id: true } });
    if (body.all !== true && !records.length) {
      const accessible = await prisma.manualExitNotification.findFirst({ where: { ...where, id: body.id }, select: { id: true } });
      if (!accessible) throw new ParkingError("Notification not found.", 404);
    }
    await prisma.manualExitNotificationRead.createMany({ data: records.map(record => ({ notificationId: record.id, userId: user.id })), skipDuplicates: true });
    return NextResponse.json({ ok: true });
  } catch (error) { return rfidApiError(error); }
}
