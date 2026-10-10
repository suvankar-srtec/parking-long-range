import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rfidUser, rfidApiError } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import { offlineReaders, planOffline } from "@/lib/cloudc-offline";

async function authorize(serial: string) {
  if (!/^[A-Za-z0-9_-]{1,62}$/.test(serial)) throw new ParkingError("Invalid controller serial.");
  const user = await rfidUser();
  if (user.role !== "SUPER_ADMIN") throw new ParkingError("Offline memory is managed by Super Admin only.", 403);
  const readers = await prisma.rfidReader.findMany({ where: { deviceNumber: { in: [serial + "-A", serial + "-B"] }, readerProtocol: "CLOUD_C" }, include: { building: true } });
  if (readers.length !== 2 || readers.some(r => !r.building || (!isPrimarySuperAdmin(user) && r.building.superAdminId !== user.id))) {
    throw new ParkingError("Assign both controller inputs to your building first.", 403);
  }
}
export async function GET(request: Request) {
  try {
    const serial = new URL(request.url).searchParams.get("serial") || "";
    await authorize(serial);
    const [config, pending, acknowledged, history] = await Promise.all([
      prisma.cloudCOffline.findUnique({ where: { serial } }),
      prisma.cloudCCommand.count({ where: { serial, status: "PENDING" } }),
      prisma.cloudCCommand.count({ where: { serial, status: "ACKNOWLEDGED" } }),
      prisma.cloudCHistory.count({ where: { serial } }),
    ]);
    return NextResponse.json({ ok: true, enabled: config?.enabled || false,
      configured: Boolean(config), slotStart: config?.slotStart, slotCount: config?.slotCount,
      timezone: config?.timezone, utcOffsetMinutes: config?.utcOffsetMinutes, pending, acknowledged, history,
      plannedAt: config?.plannedAt, lastAckAt: config?.lastAckAt, lastError: config?.lastError,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rfidApiError(error); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const serial = String(body.serial || "");
    await authorize(serial);
    if (typeof body.enabled !== "boolean") throw new ParkingError("Choose whether to enable offline memory.");
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cloudc-offline:" + serial}))`;
      const existing = await tx.cloudCOffline.findUnique({ where: { serial } });
      if (!existing) {
        if (!body.enabled || body.confirmReserved !== true) throw new ParkingError("Confirm the card slots and timezone are unused and reserved for this app.");
        const { slotStart, slotCount, timezone, utcOffsetMinutes } = body;
        if (![slotStart, slotCount, timezone, utcOffsetMinutes].every(Number.isInteger) || slotStart < 0 || slotCount < 1 || slotCount > 1000 || slotStart + slotCount > 60000 || timezone < 0 || timezone > 15 || utcOffsetMinutes < -720 || utcOffsetMinutes > 840) {
          throw new ParkingError("Enter valid unused card slots (0–59999), capacity (1–1000), and timezone (0–15).");
        }
        await tx.cloudCOffline.create({ data: { serial, enabled: true, slotStart, slotCount, timezone, utcOffsetMinutes } });
      } else {
        await tx.cloudCOffline.update({ where: { serial }, data: { enabled: body.enabled, lastError: null } });
      }
      if (body.enabled && !await offlineReaders(tx, serial)) {
        throw new ParkingError("Offline memory requires A assigned as Entry and B as Exit in the same enabled building. Registration and swapped inputs work online only.");
      }
      await planOffline(tx, serial, true);
    }, { maxWait: 5000, timeout: 20000 });
    return NextResponse.json({ ok: true, message: "Memory commands queued. Wait for controller acknowledgement before testing offline access." });
  } catch (error) { return rfidApiError(error); }
}
