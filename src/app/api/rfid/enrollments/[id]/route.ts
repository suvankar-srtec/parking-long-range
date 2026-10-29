import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rfidUser, rfidApiError, lockRfid, RFID_TRANSACTION } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await rfidUser();
    const { id } = await context.params;
    const enrollment = await prisma.rfidEnrollment.findFirst({ where: { id, ownerId: user.id } });
    if (!enrollment) throw new ParkingError("Card registration not found.", 404);
    const status = ["WAITING", "CAPTURED"].includes(enrollment.status) && enrollment.expiresAt <= new Date() ? "EXPIRED" : enrollment.status;
    return NextResponse.json({ ok: true, enrollment: { ...enrollment, status } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rfidApiError(error); }
}
async function handleDELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await rfidUser();
    const { id } = await context.params;
    await prisma.$transaction(async (tx) => {
      await lockRfid(tx);
      await tx.rfidEnrollment.updateMany({ where: { id, ownerId: user.id, status: { in: ["WAITING", "CAPTURED"] } }, data: { status: "CANCELLED" } });
    }, RFID_TRANSACTION);
    return NextResponse.json({ ok: true });
  } catch (error) { return rfidApiError(error); }
}

export const DELETE = withAuditRequest(handleDELETE);
