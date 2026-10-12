"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client-request";
import { useMutation } from "@/components/FeedbackProvider";
type Notice = { id: string; status: string; approvedByName: string | null; createdAt: string; actorName: string; buildingName: string; vehicleNumber: string; personName: string; cardNo: string; read: boolean };
type Data = { ok: boolean; unread: number; notifications: Notice[] };
const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
export default function ManualExitNotifications() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  const { pending, execute } = useMutation();
  useEffect(() => {
    const controller = new AbortController(); let fetching = false;
    async function load() {
      if (fetching) return; fetching = true;
      try { const result = await requestJson<Data>("/api/notifications", "GET", undefined, controller.signal); if (!controller.signal.aborted) { setData(result); setError(""); } }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load notifications."); }
      finally { fetching = false; }
    }
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 10000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [revision]);
  function markRead(id?: string) {
    void execute(async () => { await requestJson("/api/notifications", "PATCH", id ? { id } : { all: true }); setRevision(value => value + 1); });
  }
  function approve(id: string) {
    void execute(async () => { await requestJson(`/api/notifications/${encodeURIComponent(id)}/approve`, "POST"); setRevision(value => value + 1); });
  }
  return <section className="portfolio-card" style={{ marginTop: 20 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
      <div><h2 style={{ margin: 0 }}>Manual exit requests</h2><p className="muted">{data?.unread ?? 0} unread</p></div>
      <div style={{ display: "flex", gap: 8 }}><button className="secondary-button" onClick={() => setRevision(value => value + 1)}>Refresh</button>
        <button className="secondary-button" disabled={pending || !data?.unread} onClick={() => markRead()}>Mark all read</button></div>
    </div>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading notifications...</p>}
    {data && <div style={{ overflowX: "auto" }}><table className="manual-notifications-table">
      <thead><tr>{["Time (IST)", "Building", "Vehicle", "Person", "RFID / QR", "Supervisor", "Status", "Actions"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.notifications.map(notice => <tr key={notice.id} className={notice.read ? "" : "unread"}>
        <td>{time.format(new Date(notice.createdAt))}</td><td>{notice.buildingName}</td><td>{notice.vehicleNumber || "-"}</td><td>{notice.personName}</td><td>{notice.cardNo || "-"}</td><td>{notice.actorName}</td>
        <td>{notice.status}{notice.approvedByName && <small style={{ display: "block" }}>{notice.approvedByName}</small>}</td>
        <td>{notice.status === "PENDING" && <button className="secondary-button" disabled={pending} onClick={() => approve(notice.id)}>Approve exit</button>} {notice.read ? <span className="muted">Read</span> : <button className="secondary-button" disabled={pending} onClick={() => markRead(notice.id)}>Mark read</button>}</td>
      </tr>)}{!data.notifications.length && <tr><td colSpan={8}>No manual-exit requests yet.</td></tr>}</tbody>
    </table></div>}
    <style>{`.manual-notifications-table{width:100%;min-width:850px;border-collapse:collapse;font-size:12px}.manual-notifications-table th{text-align:left;background:#eef5fc;padding:12px;color:#53677e}.manual-notifications-table td{padding:12px;border-bottom:1px solid #e3eaf2}.manual-notifications-table .unread{background:#f7faff}.manual-notifications-table button{padding:5px 8px;font-size:11px}`}</style>
  </section>;
}
