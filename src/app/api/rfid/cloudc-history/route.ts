import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rfidUser, rfidApiError } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

export async function GET(request: Request) {
  try {
    const user = await rfidUser();
    if (user.role !== "SUPER_ADMIN") throw new ParkingError("Controller history is available to Super Admin only.", 403);
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
    if (cursor && !await prisma.cloudCHistory.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) {
      throw new ParkingError("History page is no longer available.", 404);
    }
    const [rows, total] = await Promise.all([
      prisma.cloudCHistory.findMany({ where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 101, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
      prisma.cloudCHistory.count({ where }),
    ]);
    const records = rows.slice(0, 100).map(row => {
      const packet = row.packet as Record<string, unknown>;
      const field = (key: string) => typeof packet[key] === "string" || typeof packet[key] === "number" ? String(packet[key]).slice(0, 128) : "";
      return { id: row.id, serial: row.serial, kind: row.kind, index: row.recordIndex,
        scanTime: field("EventTime"), card: field("Card"), reader: field("Reader"),
        eventType: field("EventType"), receivedAt: row.receivedAt };
    });
    return NextResponse.json({ ok: true, records, total, nextCursor: rows.length > 100 ? records[99].id : null },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return rfidApiError(error); }
}
