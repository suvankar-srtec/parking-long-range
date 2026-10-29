import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { ParkingError } from "@/lib/building-parking";
import { lockRfid, RFID_TRANSACTION } from "@/lib/rfid-access";

async function handleDELETE(
  _request: Request,
  context: { params: Promise<{ id: string; employeeId: string; vehicleId: string }> },
) {
  try {
    const { id: companyId, employeeId, vehicleId } = await context.params;
    const user = await getCurrentUser();
    if (!user || !["COMPANY_ADMIN", "BUILDING_OWNER"].includes(user.role) || user.companyId !== companyId || !hasPermission(user, "company.manageVehicles")) {
      return NextResponse.json({ ok: false, message: "Vehicle management is not assigned to this Company/User account." }, { status: 403 });
    }

    await prisma.$transaction(async (tx) => {
      await lockRfid(tx);
      const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, employeeId, companyId }, select: { id: true, plateNumber: true, isInside: true } });
      if (!vehicle) throw new ParkingError("Vehicle allocation not found.", 404);
      if (vehicle.isInside) throw new ParkingError("This vehicle is currently inside. Record its exit before removing the allocation.", 409);
      await tx.rfidEnrollment.updateMany({ where: { vehicleId, status: { in: ["WAITING", "CAPTURED"] } }, data: { status: "CANCELLED" } });
      await tx.vehicle.delete({ where: { id: vehicleId } });
    }, RFID_TRANSACTION);

    revalidatePath("/dashboard");
    return NextResponse.json({ ok: true, message: "Parking allocation removed. The RFID card is available for reuse." });
  } catch (error) {
    if (error instanceof ParkingError) return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    console.error("REMOVE_COMPANY_VEHICLE_ALLOCATION_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to remove parking allocation." }, { status: 500 });
  }
}

export const DELETE = withAuditRequest(handleDELETE);
