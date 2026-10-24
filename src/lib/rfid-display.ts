export function scanResultMessage(message: string) {
  return message.toLowerCase() === "owner parking allocation is full" ? "Allocation full" : message;
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
