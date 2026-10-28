export type VisitScan = {
  id: string; entityKey?: string; createdAt: string; action: string; code: string;
  message: string; cardNo: string; deviceNumber: string; eventType: "Online" | "Offline" | null;
  vehicle: { plateNumber: string; ownerName: string; department: string } | null;
  personType: string; company: { name: string } | null;
};

export type VisitRow = { id: string; entry: VisitScan | null; exit: VisitScan | null; latest: VisitScan; scans?: VisitScan[] };

// Pair only successful movements for the same entity. Failed scans remain visible.
// Sorting by scan time also handles controller history arriving after reconnection.
export function pairVisitScans(events: readonly VisitScan[]): VisitRow[] {
  const rows: VisitRow[] = [];
  const open = new Map<string, VisitRow>();
  const seen = new Set<string>();
  const denialGroups = new Map<string, VisitRow>();
  for (const event of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const key = event.entityKey || (event.cardNo && event.cardNo !== "VISITOR QR" && event.deviceNumber !== "MANUAL" ? event.cardNo : event.id);
    const allowed = event.code === "0000";
    if (allowed && event.action === "ENTRY") {
      const current = open.get(key);
      if (current) { current.latest = event; continue; }
      const row = { id: event.id, entry: event, exit: null, latest: event };
      rows.push(row); open.set(key, row);
    } else if (allowed && event.action === "EXIT") {
      const current = open.get(key);
      if (current) { current.exit = event; current.latest = event; open.delete(key); }
      else rows.push({ id: event.id, entry: null, exit: event, latest: event });
    } else {
      const message = event.message.trim().replace(/\.$/, "").toLowerCase();
      const kind = !allowed && ["rfid card is not registered", "not register"].includes(message) ? "unregistered"
        : !allowed && ["duplicate entry: vehicle is already inside. exit before another entry", "exit before entry"].includes(message) ? "repeated-entry" : null;
      const groupKey = kind && event.cardNo ? JSON.stringify([event.cardNo.trim().toUpperCase(), kind]) : null;
      const group = groupKey ? denialGroups.get(groupKey) : undefined;
      if (group) { group.scans!.push(event); group.latest = event; }
      else {
        const row: VisitRow = { id: event.id, entry: null, exit: null, latest: event, ...(groupKey ? { scans: [event] } : {}) };
        rows.push(row);
        if (groupKey) denialGroups.set(groupKey, row);
      }
    }
  }
  return rows.sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt) || b.latest.id.localeCompare(a.latest.id));
}


export function filterVisitRows(rows: readonly VisitRow[], query: string): readonly VisitRow[] {
  const search = query.trim().toLowerCase();
  if (!search) return rows;
  return rows.filter(row => [row.entry, row.exit, row.latest, ...(row.scans || [])].some(event => event && [
    event.cardNo, event.deviceNumber, event.vehicle?.plateNumber, event.vehicle?.ownerName,
    event.vehicle?.department, event.company?.name, event.personType, event.message,
    event.action, event.eventType, event.createdAt,
    new Date(event.createdAt).toLocaleString(),
    event.code === "0000" ? `${event.action.toLowerCase()} allowed` : "",
    event.message.toLowerCase() === "owner parking allocation is full" ? "Allocation full" : "",
  ].some(value => value?.toLowerCase().includes(search))));
}
