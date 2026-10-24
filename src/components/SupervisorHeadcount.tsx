"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { manualExitResult, scanResultMessage } from "@/lib/rfid-display";
import { Spinner } from "./LoadingIndicator";
import { useFeedback, useMutation } from "./FeedbackProvider";
import TableColumnFilter from "./TableColumnFilter";
import styles from "./SupervisorHeadcount.module.css";

const LIVE_COLUMNS = ["Time", "Device", "RFID", "Vehicle", "Owner", "Employee", "Company", "Action", "Result", "Event Type"] as const;

type ScanEvent = {
  eventType: "Online" | "Offline" | null;
  id: string;
  action: string;
  code: string;
  message: string;
  cardNo: string;
  deviceNumber: string;
  createdAt: string;
  vehicle: { plateNumber: string; ownerName: string; department: string } | null;
  personType: "OWNER" | "EMPLOYEE" | "UNKNOWN";
  company: { name: string } | null;
};

type ActiveCard = {
  id: string;
  rfidCardNo: string;
  vehicleNumber: string;
  personName: string;
  personType: "OWNER" | "EMPLOYEE" | "VISITOR";
  companyName: string;
  department: string;
  entryTime: string | null;
};

type Headcount = {
  ok: true;
  buildingName: string;
  openingOnSite: number | null;
  totalIn: number | null;
  totalOut: number | null;
  totalOnSite: number | null;
  activeCards: ActiveCard[];
  canManualExit: boolean;
  recentEvents: ScanEvent[];
  updatedAt: string;
};

type PopupState = ScanEvent & { tone: "entry" | "exit" | "denied" | "info" };

function localDayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function popupTone(event: ScanEvent): PopupState["tone"] {
  if (event.action === "ENTRY" && event.code === "0000") return "entry";
  if (event.action === "EXIT" && event.code === "0000") return "exit";
  if (event.code !== "0000" || event.action === "DENIED" || event.action === "IGNORED") return "denied";
  return "info";
}

function popupTitle(event: PopupState) {
  const message = event.message.toLowerCase();
  if (event.tone === "entry") return "Vehicle Entry";
  if (event.tone === "exit") return "Vehicle Exit";
  if (message.includes("allocation is full") || message.includes("parking is full")) return "Parking Allocation Full";
  if (event.action === "IGNORED") return "Scan Ignored";
  if (event.tone === "denied") return "Access Denied";
  return "RFID Scan";
}

function eventResult(event: ScanEvent) {
  if (event.deviceNumber === "MANUAL" && event.action === "EXIT") return manualExitResult(event.message);
  if (event.code === "0000") return event.action === "ENTRY" ? "Entry allowed" : event.action === "EXIT" ? "Exit allowed" : event.message;
  return scanResultMessage(event.message) || "Denied";
}

function mergeEvents(current: ScanEvent[], incoming: ScanEvent[]) {
  const byId = new Map<string, ScanEvent>();
  for (const event of current) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return Array.from(byId.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id))
    .slice(0, 5000);
}

export default function SupervisorHeadcount({
  showTotalOnSite = true,
  showTotalIn = true,
  showTotalOut = true,
  showLiveDashboard = true,
  showActivity = true,
}: {
  showTotalOnSite?: boolean;
  showTotalIn?: boolean;
  showTotalOut?: boolean;
  showLiveDashboard?: boolean;
  showActivity?: boolean;
}) {
  const [visibleColumns, setVisibleColumns] = useState<Set<number>>(() => new Set(LIVE_COLUMNS.map((_, index) => index)));
  const [data, setData] = useState<Headcount | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [popupQueue, setPopupQueue] = useState<PopupState[]>([]);
  const [showActiveCards, setShowActiveCards] = useState(false);
  const { notify } = useFeedback();
  const { pending: manualExitPending, execute: executeManualExit } = useMutation();
  const range = useMemo(localDayRange, []);
  const seenEventId = useRef<string | null>(null);
  const initialized = useRef(false);
  const requestInFlight = useRef(false);
  const metricCount = [showTotalOnSite, showTotalIn, showTotalOut].filter(Boolean).length;

  const load = useCallback(async () => {
    if (requestInFlight.current || document.visibilityState !== "visible") return;
    requestInFlight.current = true;
    try {
      const params = new URLSearchParams(range);
      const response = await fetch(`/api/supervisor/headcount?${params.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.message || "Unable to load real time monitor.");

      const incomingEvents = Array.isArray(next.recentEvents) ? next.recentEvents as ScanEvent[] : [];
      const newestEvent = incomingEvents[0];

      if (!initialized.current) {
        initialized.current = true;
        seenEventId.current = newestEvent?.id || null;
      } else if (showLiveDashboard && showActivity && incomingEvents.length) {
        const previousSeenId = seenEventId.current;
        const unseen: ScanEvent[] = [];

        for (const event of incomingEvents) {
          if (event.id === previousSeenId) break;
          unseen.push(event);
        }

        if (newestEvent?.id) seenEventId.current = newestEvent.id;

        if (unseen.length) {
          const ordered = unseen
            .reverse()
            .map((event) => ({ ...event, tone: popupTone(event) } as PopupState));
          setPopupQueue((current) => [...current, ...ordered]);
        }
      }

      setData((current) => ({ ...next, recentEvents: mergeEvents(current?.recentEvents || [], incomingEvents) }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load real time monitor.");
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [range, showLiveDashboard, showActivity]);

  useEffect(() => {
    let stopped = false;
    let pollTimer: number | undefined;
    async function poll() { if (stopped) return; await load(); if (!stopped) pollTimer = window.setTimeout(poll, 3000); }
    const onVisibility = () => { if (document.visibilityState === "visible") void load(); };
    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => { stopped = true; if (pollTimer !== undefined) window.clearTimeout(pollTimer); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [load]);

  useEffect(() => {
    if (popup || popupQueue.length === 0) return;
    const [nextPopup, ...rest] = popupQueue;
    setPopup(nextPopup);
    setPopupQueue(rest);
  }, [popup, popupQueue]);

  useEffect(() => {
    if (!popup) return;
    const timer = window.setTimeout(() => setPopup(null), 6000);
    return () => window.clearTimeout(timer);
  }, [popup]);

  function manualExit(card: ActiveCard) {
    const subject = card.personType === "VISITOR" ? "visitor" : "vehicle";
    if (!window.confirm(`Request approval to manually exit this ${subject}: ${card.personName} · ${card.vehicleNumber}?`)) return;
    void executeManualExit(async () => {
      const response = await fetch("/api/supervisor/manual-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: card.id }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message || "Unable to complete manual exit.");
      notify(result?.message || "Manual exit completed.");
      await load();
    });
  }

  if (!showTotalOnSite && !showTotalIn && !showTotalOut && !showLiveDashboard) {
    return <section className={`portfolio-card ${styles.headcount}`}><div className="section-kicker">SUPERVISOR</div><h2>No monitoring features assigned</h2><p className="muted">Ask the building Admin or Super Admin to enable the required Supervisor features.</p></section>;
  }

  if (loading && !data) return <section className={`portfolio-card ${styles.headcount}`}><p><Spinner /> Loading Real Time Monitor…</p></section>;

  return <>
    {popup && showLiveDashboard && showActivity ? <div className={`${styles.scanPopup} ${styles[popup.tone]}`} role="status" aria-live="polite">
      <button type="button" className={styles.popupClose} aria-label="Close notification" onClick={() => setPopup(null)}>×</button>
      <div className={styles.popupIcon} aria-hidden="true">{popup.tone === "entry" ? "IN" : popup.tone === "exit" ? "OUT" : popup.tone === "denied" ? "!" : "RF"}</div>
      <div className={styles.popupBody}><span className={styles.popupEyebrow}>LIVE RFID EVENT</span><h3>{popupTitle(popup)}</h3><p>{popup.deviceNumber === "MANUAL" && popup.action === "EXIT" ? manualExitResult(popup.message) : scanResultMessage(popup.message)}</p><div className={styles.popupMeta}><span><strong>Vehicle</strong>{popup.vehicle?.plateNumber || "Unknown"}</span><span><strong>Rider</strong>{popup.vehicle?.ownerName || "Unknown"}</span><span><strong>Company</strong>{popup.company?.name || "-"}</span><span><strong>RFID</strong>{popup.cardNo}</span></div></div>
    </div> : null}

    {metricCount > 0 ? <section className={`portfolio-card ${styles.headcount}`}>
      <div className={styles.titleRow}><div><div className="section-kicker"><span className={styles.liveDot} />REAL TIME MONITOR</div><h2>Real Time Monitor</h2><p>{data?.buildingName || "Assigned building"} · updates every 3 seconds</p></div><div className={styles.clock}><strong>{clock.toLocaleDateString()}</strong><span>{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div></div>
      <div className="portfolio-divider" />
      {error ? <div className={`parking-feedback parking-feedback-error ${styles.error}`}>{error}</div> : null}
      <div className={styles.totals} style={{ gridTemplateColumns: `repeat(${metricCount}, minmax(0, 1fr))` }}>
        {showTotalOnSite ? <button type="button" className={`${styles.totalCard} ${styles.onsite} ${styles.clickableTotal}`} onClick={() => setShowActiveCards(true)}><span>Total On Site</span><strong>{data?.totalOnSite ?? 0}</strong><small>Click to view active cards</small></button> : null}
        {showTotalIn ? <article className={`${styles.totalCard} ${styles.in}`}><span>Total IN</span><strong>{data?.totalIn ?? 0}</strong></article> : null}
        {showTotalOut ? <article className={`${styles.totalCard} ${styles.out}`}><span>Total OUT</span><strong>{data?.totalOut ?? 0}</strong></article> : null}
      </div>
    </section> : null}

    {showActiveCards ? <div className={styles.activeCardsBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setShowActiveCards(false); }}>
      <section className={styles.activeCardsModal} role="dialog" aria-modal="true" aria-label="Active RFID and visitor QR entries">
        <div className={styles.activeCardsHeader}>
          <div><div className="section-kicker">CURRENTLY ON SITE</div><h2>Active RFID / QR</h2><p>{data?.activeCards?.length || 0} active entr{(data?.activeCards?.length || 0) === 1 ? "y" : "ies"} currently inside.</p></div>
          <button type="button" className={styles.popupClose} aria-label="Close active cards" onClick={() => setShowActiveCards(false)}>×</button>
        </div>
        <div className={styles.activeCardsTableWrap}>
          <table className={styles.activeCardsTable}>
            <thead><tr><th>RFID / QR</th><th>Vehicle</th><th>Person</th><th>Type</th><th>Company</th><th>Department / Accessory</th><th>Entry time</th><th>Action</th></tr></thead>
            <tbody>{data?.activeCards?.length ? data.activeCards.map((card) => <tr key={card.id}>
              <td data-label="RFID / QR">{card.rfidCardNo}</td><td data-label="Vehicle">{card.vehicleNumber}</td><td data-label="Person">{card.personName}</td><td data-label="Type">{card.personType === "OWNER" ? "Owner" : card.personType === "VISITOR" ? "Visitor" : "Employee"}</td><td data-label="Company">{card.companyName}</td><td data-label="Department / Accessory">{card.department}</td><td data-label="Entry time">{card.entryTime ? new Date(card.entryTime).toLocaleString() : "-"}</td><td data-label="Action">{data?.canManualExit ? <button type="button" className={styles.manualExitButton} title="Request manual exit approval" aria-label={`Remove ${card.vehicleNumber}: request manual exit approval`} disabled={manualExitPending} onClick={() => manualExit(card)}>{manualExitPending ? "Please wait…" : "Remove"}</button> : "-"}</td>
            </tr>) : <tr><td colSpan={8} className={styles.emptyTable}>No active RFID cards or visitor QR entries are currently on site.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </div> : null}

    {showLiveDashboard ? <section className={`portfolio-card ${styles.scanTableCard}`}>
      <div className={styles.scanTableHeader}><div><div className="section-kicker">RFID ACTIVITY</div><h2>Live Dashboard</h2></div><TableColumnFilter columns={LIVE_COLUMNS} selected={visibleColumns} onChange={setVisibleColumns} /></div>
      {showActivity ? <div className={styles.tableWrap}><table className={styles.scanTable}><thead><tr><th hidden={!visibleColumns.has(0)}>Time</th><th hidden={!visibleColumns.has(1)}>Device</th><th hidden={!visibleColumns.has(2)}>RFID</th><th hidden={!visibleColumns.has(3)}>Vehicle</th><th hidden={!visibleColumns.has(4)}>Owner</th><th hidden={!visibleColumns.has(5)}>Employee</th><th hidden={!visibleColumns.has(6)}>Company</th><th hidden={!visibleColumns.has(7)}>Action</th><th hidden={!visibleColumns.has(8)}>Result</th><th hidden={!visibleColumns.has(9)}>Event Type</th></tr></thead><tbody>
        {visibleColumns.size === 0 ? <tr><td className={styles.emptyTable}>Select a column to display the activity table.</td></tr> : data?.recentEvents.length ? data.recentEvents.map((event) => <tr key={event.id}><td hidden={!visibleColumns.has(0)} data-label="Time">{new Date(event.createdAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", month: "short", day: "2-digit" })}</td><td hidden={!visibleColumns.has(1)} data-label="Device">{event.deviceNumber || "-"}</td><td hidden={!visibleColumns.has(2)} data-label="RFID / QR">{event.cardNo || "-"}</td><td hidden={!visibleColumns.has(3)} data-label="Vehicle">{event.vehicle?.plateNumber || "-"}</td><td hidden={!visibleColumns.has(4)} data-label="Owner" className={event.personType === "OWNER" ? styles.ownerPerson : undefined}>{event.personType === "OWNER" ? event.vehicle?.ownerName || "-" : "-"}</td><td hidden={!visibleColumns.has(5)} data-label="Employee" className={event.personType === "EMPLOYEE" ? styles.employeePerson : undefined}>{event.personType === "EMPLOYEE" ? event.vehicle?.ownerName || "-" : "-"}</td><td hidden={!visibleColumns.has(6)} data-label="Company">{event.company?.name || "-"}</td><td hidden={!visibleColumns.has(7)} data-label="Action"><span className={`${styles.actionBadge} ${event.action === "ENTRY" ? styles.entryBadge : event.action === "EXIT" ? styles.exitBadge : styles.deniedBadge}`}>{event.action}</span></td><td hidden={!visibleColumns.has(8)} data-label="Result" className={event.code === "0000" ? styles.successResult : styles.deniedResult}>{eventResult(event)}</td><td hidden={!visibleColumns.has(9)} data-label="Event Type"><span className={event.eventType === "Offline" ? styles.offlineEvent : styles.onlineEvent}>{event.eventType || "-"}</span></td></tr>) : <tr><td colSpan={Math.max(visibleColumns.size, 1)} className={styles.emptyTable}>No ENTRY, EXIT, IGNORED, or DENIED RFID activity has been recorded yet.</td></tr>}
      </tbody></table></div> : <p className="muted">RFID activity access is not assigned to this Supervisor.</p>}
    </section> : null}
  </>;
}
