import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeLocalGateway } from "@/lib/local-gateway";
import { lockRfid, rfidApiError } from "@/lib/rfid-access";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";
export async function POST(request: Request) {
 try {
  const { serial } = await authorizeLocalGateway(request); const body = await request.json();
  if (!Array.isArray(body.events) || body.events.length > 100) throw new ParkingError("Invalid gateway batch.");
  const reader = await prisma.rfidReader.findUnique({ where: { deviceNumber: serial + "-A" } });
  if (!reader?.buildingId || reader.readerProtocol !== "CLOUD_C") throw new ParkingError("Controller is not assigned.", 403);
  const buildingId = reader.buildingId;
  const acknowledged = await prisma.$transaction(async tx => {
    await lockRfid(tx); await lockBuildingParking(tx, buildingId); const ids: string[] = [];
    for (const record of body.events) {
      const id = String(record.id || ""), action = String(record.action || ""); const at = new Date(record.time);
      if (!/^local-gateway-[a-f0-9-]{36}$/.test(id) || !["ENTRY", "EXIT", "DENIED", "DUPLICATE", "IGNORED"].includes(action) || !["0", "1"].includes(record.reader) || typeof record.cardNo !== "string" || record.cardNo.length > 128 || !Number.isFinite(at.getTime()) || at.getTime() > Date.now() + 300000) throw new ParkingError("Invalid gateway event.");
      const prior = await tx.rfidEvent.findUnique({ where: { id }, select: { buildingId: true, deviceNumber: true } });
      if (prior) { if (prior.buildingId !== buildingId || !prior.deviceNumber.startsWith(serial + "-")) throw new ParkingError("Event ID belongs to another controller.", 409); ids.push(id); continue; }
      const [owner, vehicle] = await Promise.all([
        tx.buildingOwnerVehicle.findUnique({ where: { rfidCardNo: record.cardNo } }),
        tx.vehicle.findUnique({ where: { rfidCardNo: record.cardNo }, include: { company: true } }),
      ]);
      const target = owner?.buildingId === buildingId ? owner : vehicle?.company.buildingId === buildingId ? vehicle : null;
      const isOwner = target === owner && !!owner; const deviceNumber = serial + (record.reader === "0" ? "-A" : "-B");
      await tx.rfidEvent.create({ data: { id, buildingId, deviceNumber, cardNo: record.cardNo, action,
        code: ["ENTRY", "EXIT"].includes(action) ? "0000" : "0001", message: String(record.message || "Local gateway scan").slice(0, 240), createdAt: at,
        ownerVehicleId: isOwner ? owner!.id : undefined, vehicleId: target && !isOwner ? vehicle!.id : undefined, companyId: target && !isOwner ? vehicle!.companyId : undefined } });
      if (target && target.createdAt <= at && ["ENTRY", "EXIT"].includes(action) && (!target.lastAccessAt || at > target.lastAccessAt)) {
        const data = { isInside: action === "ENTRY", lastAccessAt: at, lastAccessDevice: deviceNumber };
        if (isOwner) await tx.buildingOwnerVehicle.update({ where: { id: owner!.id }, data }); else await tx.vehicle.update({ where: { id: vehicle!.id }, data });
      }
      ids.push(id);
    }
    return ids;
  }, { maxWait: 10000, timeout: 25000 });
  const contact = new Date(body.contactAt);
  if (Number.isFinite(contact.getTime()) && Math.abs(Date.now() - contact.getTime()) < 300000) await prisma.rfidReader.updateMany({
    where: { deviceNumber: { in: [serial + "-A", serial + "-B"] }, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: contact } }] }, data: { lastSeenAt: contact, connectionType: "HTTP", heartbeatSeconds: 5 } });
  return NextResponse.json({ ok: true, acknowledged });
 } catch (error) { return rfidApiError(error); }
}
