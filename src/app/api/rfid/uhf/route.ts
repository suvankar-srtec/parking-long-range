import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { prisma } from "@/lib/prisma";
import { validReaderToken } from "@/lib/rfid-http";
import { processReaderScan, rfidApiError } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";

export const runtime = "nodejs";

// Enrollment responses never authorize a relay; access responses require a mapped Cloud+ gate.
export async function POST(request: Request) {
  if (!validReaderToken(request.headers.get("x-reader-token"))) return NextResponse.json({ ok: false, message: "Reader authentication required." }, { status: 403 });
  try {
    const body = await request.json();
    const deviceNumber = String(body?.deviceNumber || "");
    const readerIp = String(body?.readerIp || "");
    if (!/^UHF-[A-F0-9]{12}$/.test(deviceNumber) || isIP(readerIp) !== 4 || !["heartbeat", "scan"].includes(body?.action)) throw new ParkingError("Invalid UHF reader packet.");
    const existing = await prisma.rfidReader.findUnique({ where: { deviceNumber } });
    if (existing && existing.readerProtocol !== "UHF_MM") throw new ParkingError("Reader protocol does not match.", 409);
    const now = new Date();
    const connected = body.connected !== false;
    const reader = body.action === "scan" && existing ? existing : await prisma.rfidReader.upsert({ where: { deviceNumber },
      create: { deviceNumber, name: "UHF network reader", readerProtocol: "UHF_MM", mode: "UNASSIGNED", enabled: false, readerIp, lastSeenAt: now, lastGatewaySeenAt: now, connectionType: "TCP", tcpConnected: true, heartbeatSeconds: 5 },
      update: { readerIp, ...(connected ? { lastSeenAt: now } : {}), lastGatewaySeenAt: now, connectionType: "TCP", tcpConnected: connected, heartbeatSeconds: 5 },
    });
    const ready = reader.enabled && !!reader.buildingId && reader.mode === "REGISTER";
    const enrollment = ready ? await prisma.rfidEnrollment.findFirst({ where: { readerId: reader.id, status: "WAITING", expiresAt: { gt: now } }, select: { id: true } }) : null;
    if (body.action === "heartbeat") return NextResponse.json({ ok: true, protocol: 2, registrationOnly: reader.mode === "REGISTER", mode: reader.mode, enabled: reader.enabled && !!reader.buildingId, captureId: enrollment?.id || null });
    const epc = String(body.epc || "").toUpperCase();
    if (!/^(?:[A-F0-9]{2}){2,62}$/.test(epc)) throw new ParkingError("Invalid EPC.");
    if (reader.enabled && reader.buildingId && ["ENTRY", "EXIT", "ENTRY_EXIT"].includes(reader.mode)) {
      if (body.mode !== reader.mode || !/^[A-Za-z0-9_-]{1,60}$/.test(String(body.controllerSerial || "")) || !/^[a-f0-9-]{36}$/.test(String(body.requestId || ""))) return NextResponse.json({ ok: true, gateAllowed: false });
      const result = await processReaderScan({ deviceNumber, decodedResult: epc, relayControllerSerial: body.controllerSerial, expectedMode: body.mode }, "TCP");
      const gateAllowed = result.code === "0000" && !!result.relay && !!result.eventId && ["ENTRY", "EXIT"].includes(result.action);
      return NextResponse.json({ ok: true, protocol: 2, requestId: body.requestId, gateAllowed, eventId: result.eventId, relay: gateAllowed ? result.relay : undefined, action: result.action, expiresAt: Date.now() + 2000, message: result.message });
    }
    if (!ready || !enrollment || body.captureId !== enrollment.id) return NextResponse.json({ ok: true, registrationOnly: true, gateAllowed: false, captured: false, message: "Start card registration for this reader before presenting the tag." });
    const result = await processReaderScan({ deviceNumber, decodedResult: epc, registrationSessionId: enrollment.id }, "TCP");
    const captured = await prisma.rfidEnrollment.findUnique({ where: { id: enrollment.id }, select: { status: true, cardNo: true } });
    return NextResponse.json({ ok: true, registrationOnly: true, gateAllowed: false, captured: captured?.status === "CAPTURED" && captured.cardNo === epc, message: result.message });
  } catch (error) { return rfidApiError(error); }
}
