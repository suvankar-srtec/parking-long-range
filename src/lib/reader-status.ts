export type ReaderConnection = {
  connectionType: string; tcpConnected: boolean; lastGatewaySeenAt: string | null;
  lastSeenAt: string | null; heartbeatSeconds: number;
  enabled?: boolean; buildingId?: string | null;
};
export function readerStatus(reader: ReaderConnection, now = Date.now()) {
  if (reader.enabled === false || reader.buildingId === null) {
    return { tone: "unknown", label: "Not configured" };
  }
  if (reader.connectionType === "TCP") {
    if (!reader.lastGatewaySeenAt || now - Date.parse(reader.lastGatewaySeenAt) > 45000) return { tone: "unknown", label: "Gateway unavailable" };
    return reader.tcpConnected ? { tone: "online", label: "Connected" } : { tone: "offline", label: "Disconnected" };
  }
  if (!reader.lastSeenAt) return { tone: "unknown", label: "No contact yet" };
  const age = now - Date.parse(reader.lastSeenAt);
  if (reader.heartbeatSeconds) return age <= reader.heartbeatSeconds * 3000 ? { tone: "online", label: "Responding" } : { tone: "offline", label: "Not responding" };
  return age < 30000 ? { tone: "online", label: "Recently active" } : { tone: "unknown", label: "Idle; no heartbeat" };
}

export function readerServerClockOffset(serverTime?: string, receivedAt = Date.now()) {
  const timestamp = serverTime ? Date.parse(serverTime) : NaN;
  return Number.isFinite(timestamp) ? timestamp - receivedAt : 0;
}
