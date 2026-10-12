export function manualExitResult(message: string) {
  const approved = /approved by\s+(.+?)\s*$/i.exec(message)?.[1];
  if (!approved) return message || "Manual exit";
  const userId = /\(([^()]+)\)\s*$/.exec(approved)?.[1];
  return `Approved by ${userId || approved}`;
}
