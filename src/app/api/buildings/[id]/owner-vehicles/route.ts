import { withAuditRequest } from "@/lib/audit-request";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";
import { lockRfid, RFID_TRANSACTION } from "@/lib/rfid-access";

const vehicleTypes = ["Two wheeler", "Four wheeler"];

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: buildingId } = await context.params;
    const user = await getCurrentUser();
    if (!user || user.role !== "BUILDING_ADMIN" || user.buildingId !== buildingId || !hasPermission(user, "building.manageOwnerParking")) {
      return NextResponse.json({ ok: false, message: "Owner Parking management is not assigned to this Admin account." }, { status: 403 });
    }
    const vehicles = await prisma.buildingOwnerVehicle.findMany({ where: { buildingId }, orderBy: { createdAt: "desc" }, select: { id: true, ownerName: true, plateNumber: true, vehicleType: true, rfidCardNo: true, isInside: true } });
    return NextResponse.json({ ok: true, vehicles }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("LIST_OWNER_PARKING_VEHICLES_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to load Owner Parking allocations." }, { status: 500 });
  }
}

async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: buildingId } = await context.params;
    const user = await getCurrentUser();
    if (!user || user.role !== "BUILDING_ADMIN" || user.buildingId !== buildingId || !hasPermission(user, "building.registerOwnerParking")) {
      return NextResponse.json({ ok: false, message: "Owner Parking registration is not assigned to this Admin account." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const ownerName = String(body?.ownerName ?? "").trim();
    const plateNumber = String(body?.plateNumber ?? "").trim().toUpperCase();
    const vehicleType = String(body?.vehicleType ?? "").trim();
    const enrollmentId = String(body?.enrollmentId ?? "").trim();
    if (!ownerName || !plateNumber || !vehicleTypes.includes(vehicleType)) return NextResponse.json({ ok: false, message: "Enter owner name, plate number, and vehicle type." }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      await lockRfid(tx);
      await lockBuildingParking(tx, buildingId);
      const building = await tx.building.findUnique({ where: { id: buildingId }, select: { id: true, enabled: true } });
      if (!building) throw new ParkingError("Building not found.", 404);
      if (!building.enabled) throw new ParkingError("Building is disabled. Vehicle registration is unavailable.", 403);

      let cardNo: string | null = null;
      let readerId: string | null = null;
      let deviceNumber: string | null = null;
      if (enrollmentId) {
        const enrollment = await tx.rfidEnrollment.findUnique({ where: { id: enrollmentId }, include: { reader: true } });
        if (!enrollment || enrollment.ownerId !== user.id || !enrollment.ownerParking || enrollment.buildingId !== buildingId) throw new ParkingError("This card registration does not belong to this Owner Parking form.", 403);
        if (enrollment.status !== "CAPTURED" || !enrollment.cardNo || enrollment.expiresAt <= new Date()) throw new ParkingError("Scan a card again before saving this registration.", 409);
        if (!enrollment.reader.enabled || enrollment.reader.mode !== "REGISTER" || enrollment.reader.buildingId !== buildingId) throw new ParkingError("The registration reader is no longer available.", 409);
        const regularCard = await tx.vehicle.findUnique({ where: { rfidCardNo: enrollment.cardNo }, select: { id: true } });
        const ownerCard = await tx.buildingOwnerVehicle.findUnique({ where: { rfidCardNo: enrollment.cardNo }, select: { id: true } });
        if (regularCard || ownerCard) throw new ParkingError("This RFID card is already assigned to another vehicle.", 409);
        cardNo = enrollment.cardNo; readerId = enrollment.readerId; deviceNumber = enrollment.reader.deviceNumber;
        await tx.rfidEnrollment.update({ where: { id: enrollment.id }, data: { status: "COMPLETED" } });
      }

      const vehicle = await tx.buildingOwnerVehicle.create({ data: { ownerName, plateNumber, vehicleType, rfidCardNo: cardNo, buildingId } });
      if (cardNo && readerId && deviceNumber) await tx.rfidEvent.create({ data: { readerId, buildingId, ownerVehicleId: vehicle.id, deviceNumber, cardNo, action: "REGISTER", code: "0000", message: "Card registered to Owner Parking vehicle." } });
      return { vehicle };
    }, RFID_TRANSACTION);

    revalidatePath("/dashboard");
    return NextResponse.json({ ok: true, message: "Owner Parking vehicle registered successfully.", vehicle: result.vehicle }, { status: 201 });
  } catch (error) {
    if (error instanceof ParkingError) return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ ok: false, message: "This plate number or RFID card is already registered." }, { status: 409 });
    console.error("CREATE_OWNER_PARKING_VEHICLE_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to register Owner Parking vehicle." }, { status: 500 });
  }
}

export const POST = withAuditRequest(handlePOST);
