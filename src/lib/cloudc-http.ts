import { isIP } from "node:net";
import { prisma } from "@/lib/prisma";
import { validReaderToken } from "@/lib/rfid-http";
import { readReaderBody } from "@/lib/rfid-reader";
import { lockRfid, RFID_TRANSACTION, processReaderScan } from "@/lib/rfid-access";
import { cloudReply, parseCloudPacket, cloudInputDevice } from "@/lib/cloudc-protocol";

function respond(fields: Record<string, string>, status = 200) {
  return new Response(cloudReply(fields), {
    status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

export async function handleCloudHttp(request: Request, heartbeat: boolean) {
  const token = new URL(request.url).searchParams.get("token");
  if (!validReaderToken(token)) return respond({ AcsRes: "0" }, 403);
  let stage = "read-body";
  try {
    const raw = await readReaderBody(request);
    stage = "parse-packet";
    const packet = parseCloudPacket(raw, request.url);
    if (heartbeat && !/^\d{1,10}$/.test(packet.Key || "")) return respond({ AcsRes: "0" }, 400);
    const reportedIp = isIP(packet.IP || "") === 4 ? { readerIp: packet.IP } : {};
    stage = "save-reader";
    await prisma.$transaction(async (tx) => {
      await lockRfid(tx);
      const inputA = cloudInputDevice(packet.Serial, "0");
      // Rename the legacy controller row to input A, preserving its ID and links.
      const legacy = await tx.rfidReader.findUnique({ where: { deviceNumber: packet.Serial } });
      const existingA = await tx.rfidReader.findUnique({ where: { deviceNumber: inputA } });
      if (legacy?.readerProtocol === "CLOUD_C" && !existingA) {
        await tx.rfidReader.update({ where: { id: legacy.id }, data: {
          deviceNumber: inputA, name: `Cloud C ${packet.Serial} - A (IN/WG1)`,
        } });
      }
      const parent = existingA || legacy;
      for (const input of ["0", "1"]) {
        const deviceNumber = cloudInputDevice(packet.Serial, input);
        await tx.rfidReader.upsert({
          where: { deviceNumber },
          create: { deviceNumber, name: `Cloud C ${packet.Serial} - ${input === "0" ? "A (IN/WG1)" : "B (OUT/WG2)"}`,
            buildingId: parent?.buildingId || null, enabled: false, mode: "ENTRY_EXIT",
            readerProtocol: "CLOUD_C", connectionType: "HTTP", heartbeatSeconds: 5,
            lastSeenAt: new Date(), ...reportedIp },
          update: { readerProtocol: "CLOUD_C", connectionType: "HTTP", tcpConnected: false,
            heartbeatSeconds: 5, lastSeenAt: new Date(), ...reportedIp },
        });
      }
    }, RFID_TRANSACTION);
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
    stage = "process-scan";
    const result = await processReaderScan({ deviceNumber: cloudInputDevice(packet.Serial, packet.Reader), decodedResult: packet.Card });
    return respond({ AcsRes: result.code === "0000" ? "1" : "0",
      ActIndex: packet.Reader, Time: "1", Card: packet.Card,
      Note: result.code === "0000" ? "Allowed" : "Denied" });
  } catch (error) {
    const detail = error as { name?: string; code?: string; meta?: { column?: string; table?: string } };
    console.error("CLOUDC_HTTP_FAILED", {
      stage,
      name: detail?.name || "UnknownError",
      code: detail?.code || null,
      column: detail?.meta?.column || null,
      table: detail?.meta?.table || null,
      reason: stage === "parse-packet" && error instanceof Error ? error.message : null,
    });
    return respond({ AcsRes: "0" });
  }
}
