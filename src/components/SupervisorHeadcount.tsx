"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { manualExitResult, scanResultMessage } from "@/lib/rfid-display";
import { Spinner } from "./LoadingIndicator";
import ActiveCardsDialog, { type ActiveCard } from "./ActiveCardsDialog";
import LiveVisitTable, { VISIT_COLUMNS as LIVE_COLUMNS } from "./LiveVisitTable";
import MonitorSummary from "./MonitorSummary";
import styles from "./SupervisorHeadcount.module.css";


type ScanEvent = {
  eventType: "Online" | "Offline" | null;
  id: string;
  entityKey?: string;
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
  const visibleColumns = useMemo(() => new Set(LIVE_COLUMNS.map((_, index) => index)), []);
  const [data, setData] = useState<Headcount | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [popupQueue, setPopupQueue] = useState<PopupState[]>([]);
  const [showActiveCards, setShowActiveCards] = useState(false);
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
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      setError(timedOut ? "" : err instanceof Error ? err.message : "Unable to load real time monitor.");
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

    {metricCount > 0 ? <MonitorSummary buildingName={data?.buildingName || "Assigned building"} clock={clock} error={error}
      totalOnSite={data?.totalOnSite ?? 0} totalIn={data?.totalIn ?? 0} totalOut={data?.totalOut ?? 0}
      showTotalOnSite={showTotalOnSite} showTotalIn={showTotalIn} showTotalOut={showTotalOut} onViewActive={() => setShowActiveCards(true)} /> : null}

    {showActiveCards && <ActiveCardsDialog cards={data?.activeCards || []} canRemove={!!data?.canManualExit} onClose={() => setShowActiveCards(false)} onChanged={load} />}

    {showLiveDashboard ? <section className={`portfolio-card ${styles.scanTableCard}`}>
      <div className={styles.scanTableHeader}><h2>Live Dashboard</h2></div>
      {showActivity ? <LiveVisitTable events={data?.recentEvents || []} visibleColumns={visibleColumns} /> : <p className="muted">RFID activity access is not assigned to this Supervisor.</p>}
    </section> : null}
  </>;
}
