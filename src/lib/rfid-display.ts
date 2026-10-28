export function scanResultMessage(message: string) {
  const normalized = message.trim().replace(/\.$/, "").toLowerCase();
  if (normalized === "owner parking allocation is full") return "Allocation full";
  if (normalized === "rfid card is not registered") return "Not Register";
  if (normalized === "duplicate entry: vehicle is already inside. exit before another entry") return "Exit before Entry";
  return message;
}

export function manualExitResult(message: string) {
  const approved = /approved by\s+(.+?)\s*$/i.exec(message)?.[1];
  if (!approved) return message || "Manual exit";
  const userId = /\(([^()]+)\)\s*$/.exec(approved)?.[1];
  return `Approved by ${userId || approved}`;
}

// Classify the recorded source, never the controller's current connection status.
export function scanEventType(event: { id: string; deviceNumber: string }): "Online" | "Offline" | null {
  if (event.deviceNumber === "MANUAL") return null;
  return event.id.startsWith("cloudc-history-") ? "Offline" : "Online";
}
