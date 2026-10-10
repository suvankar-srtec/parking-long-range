export function cloudReply(fields: Record<string, string>) {
  return `DATA=${JSON.stringify(fields)}`;
}

export function parseCloudPacket(raw: string, url: string): Record<string, string> {
  const fields: Record<string, string> = Object.fromEntries(new URL(url).searchParams);
  if (raw.trim()) {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid packet");
    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== "string" && typeof value !== "number") throw new Error("Invalid field");
      fields[key] = String(value);
    }
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fields.Serial || "")) throw new Error("Invalid serial");
  return fields;
}
