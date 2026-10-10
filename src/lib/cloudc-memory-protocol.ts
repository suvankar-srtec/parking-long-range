/** Binary commands matching the supplied CloudC Python and HTTP SDKs. */

export function memoryFrame(command: number, payload: Buffer) {

  const head = Buffer.from([2, 0, command, 0, 0, 0, 0]);

  head.writeUInt16LE(payload.length, 5);

  const body = Buffer.concat([head, payload]);

  return Buffer.concat([body, Buffer.from([body.reduce((sum, byte) => sum ^ byte, 0), 3])]).toString("hex").toUpperCase();

}

function controllerDate(date: Date, utcOffsetMinutes: number) {

  // Explicit controller clock offset; never use the Vercel server timezone.

  const local = new Date(date.getTime() + utcOffsetMinutes * 60_000);

  return Buffer.from([local.getUTCFullYear() - 2000, local.getUTCMonth() + 1,

    local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes()]);

}

export function cardCommand(index: number, card: string, timezone: number, now: Date, until: Date, utcOffsetMinutes = 0) {

  if (!Number.isInteger(index) || index < 0 || index >= 60000 ||

      !/^[1-9][0-9]{0,9}$/.test(card) || Number(card) > 0xffffffff ||

      !Number.isInteger(timezone) || timezone < 0 || timezone > 15 || until <= now) {

    throw new Error("Invalid controller card permission");

  }

  const data = Buffer.alloc(63);

  data.writeUIntLE(index, 0, 3);

  data.writeUInt32LE(Number(card), 3);

  data.fill(255, 34, 38); // No password (FFFF FFFF).

  data.writeUInt16LE(1 << timezone, 38);

  controllerDate(now, utcOffsetMinutes).copy(data, 40);

  controllerDate(until, utcOffsetMinutes).copy(data, 45);

  return memoryFrame(0xc1, data);

}

export function deleteCardCommand(index: number) {

  if (!Number.isInteger(index) || index < 0 || index >= 60000) throw new Error("Invalid card slot");

  const data = Buffer.alloc(4);

  data.writeUInt32BE(index);

  return memoryFrame(0x15, data);

}

export function timezoneCommand(index: number, until: Date, utcOffsetMinutes = 0) {

  if (!Number.isInteger(index) || index < 0 || index > 15) throw new Error("Invalid timezone slot");

  const date = controllerDate(until, utcOffsetMinutes);

  // Access bit 7 enables native anti-passback; low bits retain Card identification.
  // Verified by acknowledged HTTP command and controller APB checkbox on 80M236.
  return memoryFrame(0x0d, Buffer.from([index, 0, 0, 23, 59, 255, 0x81, ...date.subarray(0, 3), 0]));

}

export function historyIdentity(packet: Record<string, string>, utcOffsetMinutes = 0) {
  const kind = packet.type === "100" ? "CARD" : packet.type === "101" ? "ALARM" : "";
  const index = kind === "CARD" ? packet.IndexEvent : packet.IndexAlarm;
  if (!kind || !/^\d{1,10}$/.test(index || "")) throw new Error("Invalid controller history index or type");
  const rawTime = (packet.EventTime || "").trim();
  let normalized = rawTime;
  if (/^\d{14}$/.test(rawTime)) {
    normalized = `${rawTime.slice(0,4)}-${rawTime.slice(4,6)}-${rawTime.slice(6,8)}T${rawTime.slice(8,10)}:${rawTime.slice(10,12)}:${rawTime.slice(12,14)}`;
  } else {
    normalized = normalized.replace(/\//g, "-").replace(" ", "T");
  }
  let time: Date | null = null;
  const plain = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(normalized);
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);
  if (plain || zoned) {
    const parsed = new Date(normalized + (plain ? "Z" : ""));
    if (Number.isFinite(parsed.getTime())) time = new Date(parsed.getTime() - (plain ? utcOffsetMinutes * 60_000 : 0));
  }
  // Firmware-specific or missing dates must not block durable raw record storage.
  // Never guess scan time. The raw EventTime remains visible on Offline Sync.
  const suffix = time ? packet.EventTime : JSON.stringify([rawTime, packet.Card || "", packet.Reader || "", packet.EventType || ""]);
  return { kind, index, time, key: `${packet.Serial}|${kind}|${index}|${suffix}` };
}
