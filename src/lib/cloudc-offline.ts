import { reconcileHistory } from "@/lib/cloudc-history-reconcile";
import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { ParkingError } from "@/lib/building-parking";
import { prisma } from "@/lib/prisma";

import { parseGateConfig, gateReaderDirection } from "@/lib/gate-config";

import { cardCommand, revokeCardCommand, timezoneCommand, historyIdentity } from "@/lib/cloudc-memory-protocol";



type Slot = { index: number; card: string };

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export async function offlineReaders(tx: Prisma.TransactionClient, serial: string) {

  const readers = await tx.rfidReader.findMany({ where: {

    deviceNumber: { in: [serial + "-A", serial + "-B"] }, readerProtocol: "CLOUD_C",

  }, include: { building: { include: { gates: true } } }, orderBy: { deviceNumber: "asc" } });

  const [a, b] = readers;

  if (!a || !b || !a.enabled || !b.enabled || !a.buildingId || a.buildingId !== b.buildingId ||

      !a.building?.enabled || a.mode === "REGISTER" || b.mode === "REGISTER") return null;

  const direction = (reader: typeof a) => {

    const gate = reader.building!.gates.map(g => parseGateConfig(g.direction))

      .find(g => g.entryReaderId === reader.id || g.exitReaderId === reader.id);

    return gate ? gateReaderDirection(gate, reader.id) : "SELECT";

  };

  // Shared card permissions do not depend on which input is assigned Entry or Exit.

  return ["ENTRY", "EXIT", "ENTRY_EXIT"].includes(direction(a)) &&
    ["ENTRY", "EXIT", "ENTRY_EXIT"].includes(direction(b)) ? a.buildingId : null;

}

export async function planOffline(tx: Prisma.TransactionClient, serial: string, force = false) {

  const config = await tx.cloudCOffline.findUnique({ where: { serial } });

  if (!config) return;

  const now = new Date();

  if (!force && config.checkedAt && now.getTime() - config.checkedAt.getTime() < 60_000) return;

  const buildingId = config.enabled ? await offlineReaders(tx, serial) : null;

  const old = config.slots as Slot[];

  const [vehicles, owners] = buildingId ? await Promise.all([

    tx.vehicle.findMany({ where: { rfidCardNo: { not: null }, rfidBlocked: false,

      company: { buildingId, enabled: true }, employee: { isPlaceholder: false } }, select: { rfidCardNo: true } }),

    tx.buildingOwnerVehicle.findMany({ where: { buildingId, rfidBlocked: false, rfidCardNo: { not: null } }, select: { rfidCardNo: true } }),

  ]) : [[], []];

  const cards = [...new Set([...vehicles, ...owners].map(v => v.rfidCardNo!)

    .filter(card => /^[1-9][0-9]{0,9}$/.test(card) && Number(card) <= 0xffffffff))].sort();

  if (cards.length > config.slotCount) throw new ParkingError("Offline card capacity exceeded; the reserved range is too small.");

  const policy = buildingId ? await tx.building.findUnique({ where: { id: buildingId }, select: { antiPassbackEnabled: true } }) : null;
  const antiPassbackEnabled = policy?.antiPassbackEnabled !== false;
  const fingerprint = digest(JSON.stringify(["native-apb-policy-v3", buildingId, config.enabled, cards, antiPassbackEnabled]));

  const renew = config.enabled && (!config.plannedAt || now.getTime() - config.plannedAt.getTime() > 3600_000);

  await tx.cloudCOffline.update({ where: { serial }, data: { checkedAt: now } });

  if (!force && fingerprint === config.fingerprint && !renew) return;

  // Replace queued work on permission changes. An old in-flight command is followed by

  // a newer revocation/update, with a different IndexCmd to prevent stale acknowledgement.

  await tx.cloudCCommand.updateMany({ where: { serial, status: { in: ["PENDING", "FAILED"] } }, data: { status: "SUPERSEDED" } });

  const taken = new Set(old.map(s => s.index));

  const desired: Slot[] = [];

  let next = config.slotStart;

  for (const card of cards) {

    const existing = old.find(s => s.card === card);

    if (existing) desired.push(existing);

    else {

      while (taken.has(next)) next++;

      if (next >= config.slotStart + config.slotCount) throw new ParkingError("Offline card slot range is full.");

      desired.push({ index: next, card }); taken.add(next++);

    }

  }

  const until = new Date(now.getTime() + 24 * 3600_000);

  const frames = old.filter(s => !cards.includes(s.card))
    .map(s => revokeCardCommand(s.index, s.card, now, until, config.utcOffsetMinutes));

  if (desired.length) {

    frames.push(timezoneCommand(config.timezone, until, config.utcOffsetMinutes, antiPassbackEnabled));

    for (const slot of desired) frames.push(cardCommand(slot.index, slot.card, config.timezone, now, until, config.utcOffsetMinutes));

  }

  if (frames.length) await tx.cloudCCommand.createMany({ data: frames.map(frame => ({ serial, frame })) });

  await tx.cloudCOffline.update({ where: { serial }, data: {

    slots: [...old, ...desired.filter(s => !old.some(o => o.card === s.card))], fingerprint, plannedAt: now,

    lastError: config.enabled && !buildingId ? "Offline sync paused: assign both inputs to access gates in the same enabled building. Stored app cards are being removed." : null,

  } });

}

export async function offlineHeartbeat(packet: Record<string, string>): Promise<Record<string, string>> {

  // Disabled by default; no controller configuration is changed until Super Admin opts in.

  // Inventory verified locally on 2026-10-10: card indices 10000-10099 and
  // timezone index 1 are unused on 80M236. Never guess slots on other controllers.
  if (packet.Serial === "80M236") {
    await prisma.cloudCOffline.upsert({ where: { serial: packet.Serial },
      create: { serial: packet.Serial, enabled: true, slotStart: 10000,
        slotCount: 100, timezone: 1, utcOffsetMinutes: 0 }, update: {} });
  }
  const config = await prisma.cloudCOffline.findUnique({ where: { serial: packet.Serial } });

  if (!config) return {};

  return prisma.$transaction(async (tx): Promise<Record<string, string>> => {

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cloudc-offline:" + packet.Serial}))`;

    const current = await tx.cloudCCommand.findFirst({ where: { serial: packet.Serial, status: "PENDING" }, orderBy: { id: "asc" } });

    if (current && current.sentAt && String(current.id) === packet.IndexCmd) {

      if (packet.CmdOK === "1") {

        await tx.cloudCCommand.update({ where: { id: current.id }, data: { status: "ACKNOWLEDGED" } });

        await tx.cloudCOffline.update({ where: { serial: packet.Serial }, data: { lastAckAt: new Date() } });

      } else if (packet.CmdOK === "0" && current.attempts >= 3) {

        await tx.cloudCCommand.update({ where: { id: current.id }, data: { status: "FAILED" } });

        await tx.cloudCOffline.update({ where: { serial: packet.Serial }, data: { lastError: "Controller rejected a memory command. Check reserved slots and retry sync." } });

      }

    }

    await planOffline(tx, packet.Serial);

    const failed = await tx.cloudCCommand.count({ where: { serial: packet.Serial, status: "FAILED" } });

    if (failed) return {};

    const command = await tx.cloudCCommand.findFirst({ where: { serial: packet.Serial, status: "PENDING" }, orderBy: { id: "asc" } });

    if (!command) return {};

    if (command.attempts >= 3 && command.sentAt && Date.now() - command.sentAt.getTime() >= 10_000) {

      await tx.cloudCCommand.update({ where: { id: command.id }, data: { status: "FAILED" } });

      await tx.cloudCOffline.update({ where: { serial: packet.Serial }, data: { lastError: "Controller did not acknowledge a memory command. Retry sync after checking connectivity." } });

      return {};

    }

    if (!command.sentAt || Date.now() - command.sentAt.getTime() >= 10_000) {

      await tx.cloudCCommand.update({ where: { id: command.id }, data: { attempts: { increment: 1 }, sentAt: new Date() } });

    }

    return { IndexCmd: String(command.id), CmdValue: command.frame };

  }, { maxWait: 5000, timeout: 20000 });

}

export async function saveCloudHistory(packet: Record<string, string>) {

  const config = await prisma.cloudCOffline.findUnique({ where: { serial: packet.Serial } });

  const record = historyIdentity(packet, config?.utcOffsetMinutes ?? 0);

  const id = "cloudc-history-" + digest(record.key);

  const safePacket = Object.fromEntries(Object.entries(packet).filter(([key]) => key !== "token"));

  await prisma.$transaction(async tx => {

    await tx.$queryRaw`SELECT pg_advisory_xact_lock(72015002)::text`;

    await tx.cloudCHistory.upsert({ where: { id }, create: {

      id, serial: packet.Serial, kind: record.kind, recordIndex: record.index, packet: safePacket,

    }, update: {} });

    const device = ["0", "1"].includes(packet.Reader) ? packet.Serial + (packet.Reader === "0" ? "-A" : "-B") : packet.Serial;

    const reader = await tx.rfidReader.findUnique({ where: { deviceNumber: device } });

    // Historical EventType semantics vary by firmware. Preserve evidence without

    // treating a replay as authorization or guessing occupancy from an alarm.

    await tx.rfidEvent.upsert({ where: { id }, create: {

      id, readerId: reader?.id, buildingId: reader?.buildingId, deviceNumber: device,

      cardNo: record.kind === "CARD" ? (packet.Card || "").slice(0, 128) : "",

      action: "HISTORY", code: "HISTORY", ...(record.time ? { createdAt: record.time } : {}),

      message: `Controller ${record.kind.toLowerCase()} history; event type ${(packet.EventType || "unknown").slice(0, 32)}. Occupancy not replayed.`,

    }, update: {} });

    await reconcileHistory(tx, id, packet, record.time);

  }, { maxWait: 10000, timeout: 20000 });

}


// Do not admit a registered vehicle online until its offline grant is acknowledged.
// Native APB tracks the real scan on the controller; this is not a fabricated scan
// or a command to operate a relay when synchronizing memory.
export async function cloudOfflineEntryGuard(packet: Record<string, string>): Promise<string | null> {
  if (packet.Serial !== "80M236") return null;
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(72015002)::text`;
    const deviceNumber = packet.Serial + (packet.Reader === "0" ? "-A" : "-B");
    const reader = await tx.rfidReader.findUnique({ where: { deviceNumber } });
    if (!reader?.enabled || !reader.buildingId || reader.mode === "REGISTER") return null;
    const gates = await tx.gate.findMany({ where: { buildingId: reader.buildingId } });
    const gate = gates.map(g => parseGateConfig(g.direction))
      .find(g => g.entryReaderId === reader.id || g.exitReaderId === reader.id);
    if (!gate || gateReaderDirection(gate, reader.id) === "EXIT") return null;
    const [owner, vehicle] = await Promise.all([
      tx.buildingOwnerVehicle.findUnique({ where: { rfidCardNo: packet.Card } }),
      tx.vehicle.findUnique({ where: { rfidCardNo: packet.Card }, include: { company: true } }),
    ]);
    const target = owner?.buildingId === reader.buildingId ? owner
      : vehicle?.company.buildingId === reader.buildingId ? vehicle : null;
    if (!target || target.isInside || target.rfidBlocked) return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cloudc-offline:" + packet.Serial}))`;
    await planOffline(tx, packet.Serial);
    const config = await tx.cloudCOffline.findUnique({ where: { serial: packet.Serial } });
    const unfinished = await tx.cloudCCommand.count({ where: {
      serial: packet.Serial, status: { in: ["PENDING", "FAILED"] },
    } });
    const ready = config?.enabled && !config.lastError && config.plannedAt && config.lastAckAt
      && config.lastAckAt >= config.plannedAt && !unfinished
      && Array.isArray(config.slots) && (config.slots as Slot[]).some(slot => slot.card === packet.Card)
      && Date.now() - config.plannedAt.getTime() < 24 * 3600_000;
    if (ready) return null;
    const message = "Offline card memory is not ready. Keep the controller connected until sync completes.";
    await tx.rfidEvent.create({ data: {
      readerId: reader.id, buildingId: reader.buildingId, deviceNumber, cardNo: packet.Card,
      ownerVehicleId: target === owner ? owner!.id : undefined,
      vehicleId: target === vehicle ? vehicle!.id : undefined,
      companyId: target === vehicle ? vehicle!.companyId : undefined,
      action: "DENIED", code: "0001", message,
    } });
    return message;
  }, { maxWait: 10000, timeout: 20000 });
}
