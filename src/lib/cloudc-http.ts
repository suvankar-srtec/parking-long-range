import { prisma } from "@/lib/prisma";
import { validReaderToken } from "@/lib/rfid-http";
import { readReaderBody } from "@/lib/rfid-reader";
import { processReaderScan } from "@/lib/rfid-access";
import { cloudReply, parseCloudPacket } from "@/lib/cloudc-protocol";

function respond(fields: Record<string, string>, status = 200) {
  return new Response(cloudReply(fields), {
    status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

export async function handleCloudHttp(request: Request, heartbeat: boolean) {
  const token = new URL(request.url).searchParams.get("token");
  if (!validReaderToken(token)) return respond({ AcsRes: "0" }, 403);
  try {
    const packet = parseCloudPacket(await readReaderBody(request), request.url);
    if (heartbeat && !/^\d{1,10}$/.test(packet.Key || "")) return respond({ AcsRes: "0" }, 400);
    await prisma.rfidReader.upsert({
      where: { deviceNumber: packet.Serial },
      create: { deviceNumber: packet.Serial, name: `Cloud C ${packet.Serial}`,
        enabled: false, mode: "ENTRY_EXIT", connectionType: "HTTP",
        heartbeatSeconds: 5, lastSeenAt: new Date() },
      update: { connectionType: "HTTP", tcpConnected: false,
        heartbeatSeconds: 5, lastSeenAt: new Date() },
    });
    if (heartbeat) return respond({ Key: packet.Key });
    // Offline history is acknowledged, never treated as a new access request.
    if (packet.type === "100" && /^\d+$/.test(packet.IndexEvent || "")) {
      return respond({ IndexEvent: packet.IndexEvent });
    }
    if (packet.type === "101" && /^\d+$/.test(packet.IndexAlarm || "")) {
      return respond({ IndexAlarm: packet.IndexAlarm });
    }
    // Initial integration supports ordinary cards only; other credentials fail closed.
    if (packet.type !== "0" || !/^\d{1,10}$/.test(packet.Card || "") ||
        !["0", "1"].includes(packet.Reader)) return respond({ AcsRes: "0" });
    const result = await processReaderScan({ deviceNumber: packet.Serial, decodedResult: packet.Card });
    return respond({ AcsRes: result.code === "0000" ? "1" : "0",
      ActIndex: packet.Reader, Time: "1", Card: packet.Card,
      Note: result.code === "0000" ? "Allowed" : "Denied" });
  } catch {
    console.error("CLOUDC_HTTP_FAILED");
    return respond({ AcsRes: "0" });
  }
}
