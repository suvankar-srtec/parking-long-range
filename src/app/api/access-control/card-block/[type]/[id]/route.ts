import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { lockRfid, RFID_TRANSACTION } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";

async function handlePATCH(
  request: Request,
  context: { params: Promise<{ type: string; id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "BUILDING_ADMIN" || !user.buildingId || !hasPermission(user, "building.blockCards")) {
      return NextResponse.json({ ok: false, message: "Card Block is available only to the assigned Building Admin." }, { status: 403 });
    }

    const { type, id } = await context.params;
    const body = await request.json().catch(() => null);
    const blocked = body?.blocked;
    if (typeof blocked !== "boolean") {
      return NextResponse.json({ ok: false, message: "Blocked status is required." }, { status: 400 });
    }
    if (type !== "company" && type !== "owner") {
      return NextResponse.json({ ok: false, message: "Invalid card type." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockRfid(tx);

      if (type === "company") {
        const vehicle = await tx.vehicle.findFirst({
          where: { id, company: { buildingId: user.buildingId! } },
          select: { id: true, isInside: true, rfidCardNo: true, rfidBlocked: true },
        });
        if (!vehicle) throw new ParkingError("RFID card was not found in this building.", 404);
        if (!vehicle.isInside) throw new ParkingError("Only cards with a current Entry can be blocked from this page.", 409);
        if (!vehicle.rfidCardNo) throw new ParkingError("This vehicle does not have an RFID card.", 409);

        const updated = await tx.vehicle.update({
          where: { id },
          data: { rfidBlocked: blocked },
          select: { id: true, rfidBlocked: true },
        });

        await tx.rfidEvent.create({
          data: {
            buildingId: user.buildingId!,
            companyId: (await tx.vehicle.findUniqueOrThrow({ where: { id }, select: { companyId: true } })).companyId,
            vehicleId: id,
            deviceNumber: "ADMIN",
            cardNo: vehicle.rfidCardNo,
            action: blocked ? "BLOCK" : "UNBLOCK",
            code: "0000",
            message: blocked ? "RFID card blocked by Building Admin." : "RFID card unblocked by Building Admin.",
          },
        });

        return { id: updated.id, blocked: updated.rfidBlocked };
      }

      const vehicle = await tx.buildingOwnerVehicle.findFirst({
        where: { id, buildingId: user.buildingId! },
        select: { id: true, isInside: true, rfidCardNo: true, rfidBlocked: true },
      });
      if (!vehicle) throw new ParkingError("RFID card was not found in this building.", 404);
      if (!vehicle.isInside) throw new ParkingError("Only cards with a current Entry can be blocked from this page.", 409);
      if (!vehicle.rfidCardNo) throw new ParkingError("This vehicle does not have an RFID card.", 409);

      const updated = await tx.buildingOwnerVehicle.update({
        where: { id },
        data: { rfidBlocked: blocked },
        select: { id: true, rfidBlocked: true },
      });

      await tx.rfidEvent.create({
        data: {
          buildingId: user.buildingId!,
          ownerVehicleId: id,
          deviceNumber: "ADMIN",
          cardNo: vehicle.rfidCardNo,
          action: blocked ? "BLOCK" : "UNBLOCK",
          code: "0000",
          message: blocked ? "RFID card blocked by Building Admin." : "RFID card unblocked by Building Admin.",
        },
      });

      return { id: updated.id, blocked: updated.rfidBlocked };
    }, RFID_TRANSACTION);

    revalidatePath("/access-control/card-block");
    revalidatePath("/access-control/activity");
    return NextResponse.json({
      ok: true,
      message: blocked ? "RFID card blocked successfully." : "RFID card unblocked successfully.",
      card: result,
    });
  } catch (error) {
    if (error instanceof ParkingError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    console.error("UPDATE_RFID_BLOCK_STATUS_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to update RFID card status." }, { status: 500 });
  }
}

export const PATCH = withAuditRequest(handlePATCH);
