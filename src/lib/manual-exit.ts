import type { Prisma } from "@prisma/client";
import { ParkingError } from "@/lib/building-parking";
export async function manualExitTarget(tx: Prisma.TransactionClient, kind: string, id: string) {
  if (kind === "vehicle") {
    const row = await tx.vehicle.findUnique({ where: { id }, include: { company: { select: { buildingId: true } } } });
    if (!row) throw new ParkingError("Vehicle not found.", 404);
    return { kind, id, buildingId: row.company.buildingId, companyId: row.companyId, isInside: row.isInside, lastAccessAt: row.lastAccessAt, cardNo: row.rfidCardNo || "", vehicleNumber: row.plateNumber, personName: row.ownerName };
  }
  if (kind === "owner") {
    const row = await tx.buildingOwnerVehicle.findUnique({ where: { id } });
    if (!row) throw new ParkingError("Owner vehicle not found.", 404);
    return { kind, id, buildingId: row.buildingId, companyId: null, isInside: row.isInside, lastAccessAt: row.lastAccessAt, cardNo: row.rfidCardNo || "", vehicleNumber: row.plateNumber, personName: row.ownerName };
  }
  if (kind === "visitor") {
    const row = await tx.visitor.findUnique({ where: { id } });
    if (!row) throw new ParkingError("Visitor not found.", 404);
    return { kind, id, buildingId: row.buildingId, companyId: row.companyId, isInside: row.isInside, lastAccessAt: row.lastAccessAt, cardNo: "VISITOR-QR", vehicleNumber: row.vehicleNumber || "", personName: row.name };
  }
  throw new ParkingError("Invalid active-card selection.");
}
export async function completeManualExit(tx: Prisma.TransactionClient, target: Awaited<ReturnType<typeof manualExitTarget>>, message: string) {
  if (!target.isInside) throw new ParkingError("This vehicle is already outside.", 409);
  const data = { isInside: false, lastAccessAt: new Date(), lastAccessDevice: "MANUAL" };
  if (target.kind === "vehicle") await tx.vehicle.update({ where: { id: target.id }, data });
  else if (target.kind === "owner") await tx.buildingOwnerVehicle.update({ where: { id: target.id }, data });
  else await tx.visitor.update({ where: { id: target.id }, data: { ...data, qrEntryUsed: true } });
  return tx.rfidEvent.create({ data: { buildingId: target.buildingId, companyId: target.companyId,
    vehicleId: target.kind === "vehicle" ? target.id : null, ownerVehicleId: target.kind === "owner" ? target.id : null,
    visitorId: target.kind === "visitor" ? target.id : null, deviceNumber: "MANUAL", cardNo: target.cardNo || "MANUAL", action: "EXIT", code: "0000", message } });
}
