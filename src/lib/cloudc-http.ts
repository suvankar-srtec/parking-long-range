import { isIP } from "node:net";
import { prisma } from "@/lib/prisma";
import { validReaderToken } from "@/lib/rfid-http";
import { readReaderBody } from "@/lib/rfid-reader";
import { lockRfid, RFID_TRANSACTION, processReaderScan } from "@/lib/rfid-access";
import { cloudReply, parseCloudPacket, cloudInputDevice } from "@/lib/cloudc-protocol";

import { offlineHeartbeat, saveCloudHistory, cloudOfflineEntryGuard } from "@/lib/cloudc-offline";

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
    const inputDevices = [cloudInputDevice(packet.Serial, "0"), cloudInputDevice(packet.Serial, "1")];
    // Routine heartbeats need one update, not the global access/enrollment lock.
    const contact = await prisma.rfidReader.updateMany({
      where: { deviceNumber: { in: inputDevices }, readerProtocol: "CLOUD_C" },
      data: { lastSeenAt: new Date(), connectionType: "HTTP", tcpConnected: false,
        heartbeatSeconds: 5, ...reportedIp },
    });
    if (contact.count !== 2) await prisma.$transaction(async (tx) => {
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
      for (const input of ["0", "1"]) {
        const deviceNumber = cloudInputDevice(packet.Serial, input);
        await tx.rfidReader.upsert({
          where: { deviceNumber },
          create: { deviceNumber, name: `Cloud C ${packet.Serial} - ${input === "0" ? "A (IN/WG1)" : "B (OUT/WG2)"}`,
            buildingId: null, enabled: false, mode: "ENTRY_EXIT",
            readerProtocol: "CLOUD_C", connectionType: "HTTP", heartbeatSeconds: 5,
            lastSeenAt: new Date(), ...reportedIp },
          update: { readerProtocol: "CLOUD_C", connectionType: "HTTP", tcpConnected: false,
            heartbeatSeconds: 5, lastSeenAt: new Date(), ...reportedIp },
        });
      }
    }, RFID_TRANSACTION);
    if (heartbeat) {
      stage = "offline-sync";
      try { return respond({ Key: packet.Key, ...await offlineHeartbeat(packet) }); }
      catch {
        console.error("CLOUDC_OFFLINE_SYNC_FAILED", { serial: packet.Serial });
        await prisma.cloudCOffline.updateMany({ where: { serial: packet.Serial }, data: {
          lastError: "Memory sync could not be planned. Check reserved capacity and retry sync.",
        } }).catch(() => undefined);
        return respond({ Key: packet.Key });
      }
    }
    // Acknowledge only after durable storage; retries are deduplicated.
    if (packet.type === "100" && /^\d+$/.test(packet.IndexEvent || "")) {
      stage = "save-history";
      await saveCloudHistory(packet);
      return respond({ IndexEvent: packet.IndexEvent });
    }
    if (packet.type === "101" && /^\d+$/.test(packet.IndexAlarm || "")) {
      stage = "save-history";
      await saveCloudHistory(packet);
      return respond({ IndexAlarm: packet.IndexAlarm });
    }
    // Initial integration supports ordinary cards only; other credentials fail closed.
    if (packet.type !== "0" || !/^\d{1,10}$/.test(packet.Card || "") ||
        !["0", "1"].includes(packet.Reader)) return respond({ AcsRes: "0" });
    stage = "verify-offline-entry";
    const memoryIssue = await cloudOfflineEntryGuard(packet);
    if (memoryIssue) return respond({ AcsRes: "0", Reader: packet.Reader, Card: packet.Card, Note: "Offline memory not ready" });
    stage = "process-scan";
    const result = await processReaderScan({ deviceNumber: cloudInputDevice(packet.Serial, packet.Reader), decodedResult: packet.Card });
    return respond({ AcsRes: result.code === "0000" ? "1" : "0",
      Reader: packet.Reader, ActIndex: packet.Reader, Time: "1", Card: packet.Card,
      Note: result.code === "0000" ? "Allowed" : "Denied" });
  } catch (error) {
    const detail = error as { name?: string; code?: string; meta?: { column?: string; table?: string } };
    console.error("CLOUDC_HTTP_FAILED", {
      stage,
      name: detail?.name || "UnknownError",
      code: detail?.code || null,
      column: detail?.meta?.column || null,
      table: detail?.meta?.table || null,
      reason: ["parse-packet", "save-history"].includes(stage) && detail?.name === "Error" && error instanceof Error ? error.message : null,
    });
    return respond({ AcsRes: "0" });
  }
}
