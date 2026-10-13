import { NextResponse } from "next/server";
import { historyIdentity } from "@/lib/cloudc-memory-protocol";
import { prisma } from "@/lib/prisma";
import { rfidUser, rfidApiError } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

export async function GET(request: Request) {
  try {
    const user = await rfidUser();
    if (user.role !== "SUPER_ADMIN") throw new ParkingError("Controller history is not available to this account.", 403);
    const params = new URL(request.url).searchParams;
    const serial = params.get("serial");
    const cursor = params.get("cursor");
    if (cursor && !/^cloudc-history-[a-f0-9]{64}$/.test(cursor)) throw new ParkingError("Invalid history cursor.");
    const readers = await prisma.rfidReader.findMany({
      where: { readerProtocol: "CLOUD_C", ...(isPrimarySuperAdmin(user) ? {} : { building: { superAdminId: user.id } }) },
      select: { deviceNumber: true },
    });
    const serials = [...new Set(readers.filter(r => /-[AB]$/.test(r.deviceNumber)).map(r => r.deviceNumber.slice(0, -2)))];
    if (serial && !serials.includes(serial)) throw new ParkingError("This controller is not available to your account.", 403);
    const where = { serial: { in: serial ? [serial] : serials } };
    // Gateway uploads are already reconciled movement records, separate from native history.
    if (params.get("source") === "gateway") {
      const selectedSerials = serial ? [serial] : serials;
      const events = await prisma.rfidEvent.findMany({
        where: { id: { startsWith: "local-gateway-" },
          deviceNumber: { in: selectedSerials.flatMap(value => [value + "-A", value + "-B"]) },
          ...(isPrimarySuperAdmin(user) ? {} : { building: { superAdminId: user.id } }) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
        select: { id: true, deviceNumber: true, cardNo: true, createdAt: true, action: true, code: true },
      });
      return NextResponse.json({ ok: true, records: events.map(event => ({
        id: event.id, serial: event.deviceNumber.slice(0, -2), kind: "CARD", index: "",
        scanTime: event.createdAt.toISOString(), scanTimeIso: event.createdAt.toISOString(),
        card: event.cardNo, reader: event.deviceNumber.endsWith("-A") ? "0" : "1",
        eventType: event.code, action: event.action, source: "Gateway", receivedAt: event.createdAt,
      })) }, { headers: { "Cache-Control": "no-store" } });
    }

    if (cursor && !await prisma.cloudCHistory.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) {
      throw new ParkingError("History page is no longer available.", 404);
    }
    const [rows, total, configs, commands] = await Promise.all([
      prisma.cloudCHistory.findMany({ where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 101, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
      prisma.cloudCHistory.count({ where }),
      prisma.cloudCOffline.findMany({ where: { serial: where.serial } }),
      prisma.cloudCCommand.groupBy({ by: ["serial", "status"], where: { serial: where.serial }, _count: { _all: true } }),
    ]);
    const records = rows.slice(0, 100).map(row => {
      const packet = row.packet as Record<string, unknown>;
      const field = (key: string) => typeof packet[key] === "string" || typeof packet[key] === "number" ? String(packet[key]).slice(0, 128) : "";
      const scan = historyIdentity({
        Serial: row.serial, type: row.kind === "CARD" ? "100" : "101",
        IndexEvent: row.recordIndex, IndexAlarm: row.recordIndex,
        EventTime: field("EventTime"), Card: field("Card"),
        Reader: field("Reader"), EventType: field("EventType"),
      }, configs.find(config => config.serial === row.serial)?.utcOffsetMinutes ?? 0);
      return { id: row.id, serial: row.serial, kind: row.kind, index: row.recordIndex,
        scanTime: field("EventTime"), scanTimeIso: scan.time?.toISOString() ?? null, card: field("Card"), reader: field("Reader"),
        eventType: field("EventType"), receivedAt: row.receivedAt };
    });
    const sync = (serial ? [serial] : serials).map(value => {
      const config = configs.find(c => c.serial === value);
      const count = (status: string) => commands.find(c => c.serial === value && c.status === status)?._count._all || 0;
      return { serial: value, enabled: config?.enabled || false, configured: Boolean(config),
        trackedCards: Array.isArray(config?.slots) ? config.slots.length : 0,
        pending: count("PENDING"), failed: count("FAILED"), lastAckAt: config?.lastAckAt || null,
        lastError: config?.lastError || null };
    });
    return NextResponse.json({ ok: true, records, total, sync, nextCursor: rows.length > 100 ? records[99].id : null },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rfidApiError(error); }
}
