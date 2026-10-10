"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client-request";

type RecordRow = { id: string; serial: string; kind: string; index: string; scanTime: string;
  card: string; reader: string; eventType: string; receivedAt: string };
type SyncStatus = { serial: string; configured: boolean; enabled: boolean; trackedCards: number; pending: number; failed: number; lastAckAt: string | null; lastError: string | null };
type History = { sync: SyncStatus[]; ok: boolean; records: RecordRow[]; total: number; nextCursor: string | null };
export default function CloudCOfflineHistory({ controllers }: { controllers: string[] }) {
  const [serial, setSerial] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    async function load() {
      if (fetching) return;
      fetching = true;
      const params = new URLSearchParams();
      if (serial) params.set("serial", serial);
      if (cursor) params.set("cursor", cursor);
      try {
        const result = await requestJson<History>("/api/rfid/cloudc-history?" + params, "GET", undefined, controller.signal);
        if (!controller.signal.aborted) { setData(result); setError(""); }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load controller history.");
      } finally { fetching = false; if (!controller.signal.aborted) setLoading(false); }
    }
    setLoading(true); setData(null);
    void load();
    const timer = cursor ? null : setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => { controller.abort(); if (timer) clearInterval(timer); };
  }, [serial, cursor, refresh]);
  return <section className="portfolio-card" aria-label="Uploaded controller records">
    <div className="reader-toolbar">
      <h2>Uploaded controller records</h2>
      <label>Controller <select value={serial} onChange={e => { setSerial(e.target.value); setCursor(null); }}>
        <option value="">All controllers</option>
        {controllers.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button type="button" className="secondary-button" onClick={() => setRefresh(v => v + 1)} disabled={loading}>Refresh</button>
    </div>
    <p className="muted">Records appear after the controller uploads them. Scan time is the controller's saved clock time; upload time is shown in India time. History can include online and offline scans. Event codes are reported by the controller.</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading controller records...</p>}
    {data && <>
      {data.sync.map(status => <div key={status.serial} className="reader-card">
        <h3>{status.serial} - card memory sync</h3>
        <p>{!status.configured ? "Waiting for automatic memory initialization" : status.enabled ? "Automatic sync enabled" : "Memory sync disabled"}</p>
        <p>{status.trackedCards} tracked cards - {status.pending} commands pending - {status.failed} failed</p>
        <p>Last acknowledged command: {status.lastAckAt ? new Date(status.lastAckAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "None"}</p>
        {status.lastError && <p role="alert">{status.lastError}</p>}
        <p className="muted">Wait for pending commands to reach zero with no failures before testing offline. Blocks and deletions reach controller memory only while connected.</p>
      </div>)}
      <p>{data.total} stored records. Latest records refresh automatically every 10 seconds.</p>
      <div style={{ overflowX: "auto" }}>
        <table className="rfid-reader-table" style={{ minWidth: 950 }}>
          <thead><tr><th>Scan time (controller)</th><th>Controller</th><th>Reader</th><th>Card</th><th>Kind</th><th>Event code</th><th>Record index</th><th>Uploaded (India)</th></tr></thead>
          <tbody>{data.records.map(row => <tr key={row.id}>
            <td>{row.scanTime || "Unknown"}</td><td>{row.serial}</td>
            <td>{row.reader === "0" ? "A / IN" : row.reader === "1" ? "B / OUT" : row.reader ? `Input ${row.reader}` : "Unknown"}</td>
            <td>{row.card || "-"}</td><td>{row.kind}</td><td>{row.eventType || "Unknown"}</td><td>{row.index}</td>
            <td>{new Date(row.receivedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!data.records.length && <p>No controller history has been uploaded yet. A green connection indicator confirms contact, but does not confirm history upload.</p>}
      <div className="reader-card-actions">
        {cursor && <button type="button" className="secondary-button" onClick={() => setCursor(null)}>Latest records</button>}
        {data.nextCursor && <button type="button" className="secondary-button" onClick={() => setCursor(data.nextCursor)}>Older records</button>}
      </div>
    </>}
  </section>;
}
