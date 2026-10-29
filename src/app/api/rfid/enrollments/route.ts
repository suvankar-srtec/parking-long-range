import { withAuditRequest } from "@/lib/audit-request";
import { companyCardScope } from "@/lib/company-card-access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rfidUser, rfidApiError, lockRfid, expireEnrollments, RFID_TRANSACTION } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";
import { hasPermission } from "@/lib/permissions";

const REGISTRATION_WINDOW_MS = 30_000;

async function handlePOST(request: Request) {
  try {
    const user = await rfidUser();
    const body = await request.json().catch(() => null);
    const readerId = String(body?.readerId ?? "");
    const employeeId = String(body?.employeeId ?? "");
    const buildingId = String(body?.buildingId ?? "");
    const ownerParking = body?.ownerParking === true;
    const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : null;

    const enrollment = await prisma.$transaction(async (tx) => {
      await lockRfid(tx);
      await expireEnrollments(tx);

      if (ownerParking) {
        if (user.role !== "BUILDING_ADMIN" || !user.buildingId || user.buildingId !== buildingId || !hasPermission(user, "building.registerOwnerParking")) {
          throw new ParkingError("Owner Parking RFID registration is not assigned to this Admin account.", 403);
        }
        const building = await tx.building.findUnique({ where: { id: buildingId }, select: { id: true, enabled: true } });
        if (!building) throw new ParkingError("Building not found.", 404);
        if (!building.enabled) throw new ParkingError("Building is disabled. Card registration is unavailable.", 403);
        const reader = await tx.rfidReader.findUnique({ where: { id: readerId } });
        if (!reader || reader.buildingId !== buildingId || !reader.enabled || reader.mode !== "REGISTER") throw new ParkingError("Select an enabled registration reader for this building.");
        await tx.rfidEnrollment.updateMany({ where: { readerId, ownerId: user.id, status: { in: ["WAITING", "CAPTURED"] } }, data: { status: "CANCELLED" } });
        const otherRegistration = await tx.rfidEnrollment.findFirst({ where: { readerId, ownerId: { not: user.id }, status: { in: ["WAITING", "CAPTURED"] }, expiresAt: { gt: new Date() } }, select: { id: true } });
        if (otherRegistration) throw new ParkingError("This reader is being used by another card registration. Try again when it finishes.", 409);
        return tx.rfidEnrollment.create({ data: { readerId, ownerId: user.id, buildingId, ownerParking: true, expiresAt: new Date(Date.now() + REGISTRATION_WINDOW_MS) } });
      }

      if (user.role === "COMPANY_ADMIN" && !hasPermission(user, "company.registerRfid")) {
        throw new ParkingError("RFID registration is not assigned to this Company/User account.", 403);
      }
      const employee = await tx.employee.findFirst({ where: { id: employeeId, company: companyCardScope(user) }, include: { company: { select: { id: true, buildingId: true } } } });
      if (!employee) throw new ParkingError("Employee or company owner not found.", 404);
      if (employee.isPlaceholder) throw new ParkingError("Complete this employee roster slot before registering a card.");
      const buildingStatus = await tx.building.findUnique({ where: { id: employee.company.buildingId }, select: { enabled: true } });
      if (!buildingStatus?.enabled) throw new ParkingError("Building is disabled. Card registration is unavailable.", 403);
      const reader = await tx.rfidReader.findUnique({ where: { id: readerId } });
      if (!reader || reader.buildingId !== employee.company.buildingId || !reader.enabled || reader.mode !== "REGISTER") throw new ParkingError("Select an enabled registration reader for this building.");
      if (vehicleId) {
        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, employeeId, companyId: employee.companyId } });
        if (!vehicle) throw new ParkingError("Vehicle not found.", 404);
        if (vehicle.isInside) throw new ParkingError("Record the vehicle's exit before replacing its card.", 409);
      }
      await tx.rfidEnrollment.updateMany({ where: { readerId, ownerId: user.id, status: { in: ["WAITING", "CAPTURED"] } }, data: { status: "CANCELLED" } });
      const otherRegistration = await tx.rfidEnrollment.findFirst({ where: { readerId, ownerId: { not: user.id }, status: { in: ["WAITING", "CAPTURED"] }, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (otherRegistration) throw new ParkingError("This reader is being used by another card registration. Try again when it finishes.", 409);
      return tx.rfidEnrollment.create({ data: { readerId, employeeId, vehicleId, ownerId: user.id, companyId: employee.companyId, buildingId: employee.company.buildingId, expiresAt: new Date(Date.now() + REGISTRATION_WINDOW_MS) } });
    }, RFID_TRANSACTION);

    return NextResponse.json({ ok: true, enrollment, message: "Reader ready. Scan the new card within 30 seconds." }, { status: 201 });
  } catch (error) {
    return rfidApiError(error);
  }
}

export const POST = withAuditRequest(handlePOST);
