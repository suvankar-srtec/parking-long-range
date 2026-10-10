"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client-request";

type RecordRow = { id: string; serial: string; kind: string; index: string; scanTime: string;
  card: string; reader: string; eventType: string; receivedAt: string };
type History = { ok: boolean; records: RecordRow[] };
export default function CloudCOfflineHistory({ controllers }: { controllers: string[] }) {
  const [serial, setSerial] = useState("");
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
      try {
        const result = await requestJson<History>("/api/rfid/cloudc-history?" + params, "GET", undefined, controller.signal);
        if (!controller.signal.aborted) { setData(result); setError(""); }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load controller history.");
      } finally { fetching = false; if (!controller.signal.aborted) setLoading(false); }
    }
    setLoading(true); setData(null);
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => { controller.abort(); if (timer) clearInterval(timer); };
  }, [serial, refresh]);
  // Persisted history has completed its upload and must leave this pending view.
  // Unsent controller records cannot be queried while the controller is offline.
  const pendingRecords = data?.records.filter(row => !row.receivedAt) ?? [];
  return <section className="portfolio-card" aria-label="Pending controller records">
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
      <h2 style={{ margin: 0, marginRight: "auto" }}>Pending records</h2>
      <label>Controller <select value={serial} onChange={e => setSerial(e.target.value)}>
        <option value="">All controllers</option>
        {controllers.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button type="button" className="secondary-button" onClick={() => setRefresh(v => v + 1)} disabled={loading}>Refresh</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 650, borderCollapse: "collapse", textAlign: "left" }}>
        <thead><tr>{["Scan time", "Controller", "Reader", "Card", "Type", "Event code"].map(title =>
          <th key={title} scope="col" style={{ padding: "12px 10px", background: "#eef5fa", borderBottom: "1px solid #dbe5ed" }}>{title}</th>
        )}</tr></thead>
        <tbody>{pendingRecords.map(row => <tr key={row.id}>
          <td>{row.scanTime || "Unknown"}</td><td>{row.serial}</td>
          <td>{row.reader === "0" ? "A / IN" : row.reader === "1" ? "B / OUT" : row.reader || "-"}</td>
          <td>{row.card || "-"}</td><td>{row.kind}</td><td>{row.eventType || "-"}</td>
        </tr>)}
        {!pendingRecords.length && <tr><td colSpan={6} style={{ padding: "20px 10px", color: "#64748b" }} role="status">
          {loading ? "Loading..." : error ? "Records unavailable." : "Uploaded records cleared. Unsent scans remain on the controller until it reconnects."}
        </td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
