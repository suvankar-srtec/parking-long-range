import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockBuildingParking } from "@/lib/building-parking";
import { historyIdentity } from "@/lib/cloudc-memory-protocol";

export async function reconcileHistory(tx: Prisma.TransactionClient, id: string, packet: Record<string, string>, time: Date | null) {
  // Verified on 80M236: successful native entry=11, exit=10. Do not infer
  // movement from an input number, rejected card, or undocumented firmware code.
  const action = packet.Serial === "80M236" && packet.type === "100"
    ? packet.EventType === "11" ? "ENTRY" : packet.EventType === "10" ? "EXIT" : null : null;
  if (!action || !time || time.getTime() > Date.now() + 300_000) return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(72015002)::text`;
  const event = await tx.rfidEvent.findUnique({ where: { id } });
  if (!event || event.action !== "HISTORY") return;
  const reader = await tx.rfidReader.findUnique({ where: { deviceNumber: event.deviceNumber } });
  if (!reader?.buildingId) return;
  await lockBuildingParking(tx, reader.buildingId);
  const [owner, vehicle] = await Promise.all([
    tx.buildingOwnerVehicle.findUnique({ where: { rfidCardNo: packet.Card } }),
    tx.vehicle.findUnique({ where: { rfidCardNo: packet.Card }, include: { company: true } }),
  ]);
  const target = owner?.buildingId === reader.buildingId ? owner
    : vehicle?.company.buildingId === reader.buildingId ? vehicle : null;
  if (!target || target.createdAt > time) return;
  const ownerVehicleId = target === owner ? owner!.id : undefined;
  const vehicleId = target === vehicle ? vehicle!.id : undefined;
  // An online decision and its uploaded controller history describe one scan.
  const online = await tx.rfidEvent.findFirst({ where: {
    id: { not: id }, deviceNumber: event.deviceNumber, cardNo: packet.Card,
    action, code: "0000", ...(ownerVehicleId ? { ownerVehicleId } : { vehicleId }),
    createdAt: { gte: new Date(time.getTime() - 3000), lte: new Date(time.getTime() + 3000) },
  } });
  await tx.rfidEvent.update({ where: { id }, data: {
    ownerVehicleId, vehicleId, companyId: vehicleId ? vehicle!.companyId : undefined,
    buildingId: reader.buildingId, createdAt: time,
    action: online ? "SYNCED" : action, code: online ? "HISTORY_LINKED" : "0000",
    message: online ? "Controller record linked to existing online scan."
      : `Offline ${action.toLowerCase()} recorded by controller.`,
  } });
  if (!online && (!target.lastAccessAt || time > target.lastAccessAt)) {
    const data = { isInside: action === "ENTRY", lastAccessAt: time, lastAccessDevice: event.deviceNumber };
    if (ownerVehicleId) await tx.buildingOwnerVehicle.update({ where: { id: ownerVehicleId }, data });
    else await tx.vehicle.update({ where: { id: vehicleId! }, data });
  }
}

export async function reconcileStoredHistory(serial: string) {
  if (serial !== "80M236") return;
  const events = await prisma.rfidEvent.findMany({ where: {
    deviceNumber: { in: [serial + "-A", serial + "-B"] }, action: "HISTORY", code: "HISTORY",
    OR: [{ message: { contains: "event type 10." } }, { message: { contains: "event type 11." } }],
  }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 20 });
  if (!events.length) return;
  const config = await prisma.cloudCOffline.findUnique({ where: { serial } });
  const records = await prisma.cloudCHistory.findMany({ where: { id: { in: events.map(event => event.id) } } });
  for (const row of records) {
    const packet = Object.fromEntries(Object.entries(row.packet as Record<string, unknown>)
      .filter(([, value]) => typeof value === "string" || typeof value === "number")
      .map(([key, value]) => [key, String(value)]));
    const record = historyIdentity(packet, config?.utcOffsetMinutes ?? 0);
    await prisma.$transaction(tx => reconcileHistory(tx, row.id, packet, record.time), { maxWait: 10000, timeout: 20000 });
  }
}
