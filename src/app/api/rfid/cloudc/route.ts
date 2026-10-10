import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validReaderToken } from "@/lib/rfid-http";
import { readReaderBody } from "@/lib/rfid-reader";
import { processReaderScan } from "@/lib/rfid-access";

export async function POST(request: Request) {
  if (!validReaderToken(request.headers.get("x-gateway-token"), process.env.RFID_GATEWAY_TOKEN)) {
    return NextResponse.json({ code: "0001" }, { status: 403 });
  }
  try {
    const body = JSON.parse(await readReaderBody(request));
    const { deviceNumber, readerIp, connectionId, decodedResult } = body;
    if (typeof deviceNumber !== "string" || typeof readerIp !== "string" ||
        typeof connectionId !== "string" || typeof decodedResult !== "string" ||
        !decodedResult.trim() || decodedResult.length > 256 || /[\u0000-\u001f\u007f]/.test(decodedResult)) {
      return NextResponse.json({ code: "0001" }, { status: 400 });
    }
    const reader = await prisma.rfidReader.findUnique({ where: { deviceNumber } });
    if (!reader || reader.connectionType !== "TCP" || reader.readerIp !== readerIp ||
        reader.connectionId !== connectionId || !reader.tcpConnected) {
      return NextResponse.json({ code: "0001" }, { status: 403 });
    }
    const result = await processReaderScan({ deviceNumber, decodedResult }, "TCP");
    return NextResponse.json({ code: result.code === "0000" ? "0000" : "0001" });
  } catch {
    return NextResponse.json({ code: "0001" }, { status: 400 });
  }
}
