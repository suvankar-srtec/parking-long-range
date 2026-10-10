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
  return memoryFrame(0x0d, Buffer.from([index, 0, 0, 23, 59, 255, 1, ...date.subarray(0, 3), 0]));
}
export function historyIdentity(packet: Record<string, string>, utcOffsetMinutes = 0) {
  const kind = packet.type === "100" ? "CARD" : packet.type === "101" ? "ALARM" : "";
  const index = kind === "CARD" ? packet.IndexEvent : packet.IndexAlarm;
  if (!kind || !/^\d{1,10}$/.test(index || "") ||
      !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(packet.EventTime || "")) {
    throw new Error("Invalid controller history");
  }
  const time = new Date(new Date(packet.EventTime.replace(" ", "T") + "Z").getTime() - utcOffsetMinutes * 60_000);
  if (!Number.isFinite(time.getTime())) throw new Error("Invalid controller history time");
  return { kind, index, time, key: `${packet.Serial}|${kind}|${index}|${packet.EventTime}` };
}
