"use client";
import { manualExitResult } from "@/lib/rfid-display";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "./LoadingIndicator";
import OverstayAlert, { type OverstayCard } from "./OverstayAlert";
import TableColumnFilter from "./TableColumnFilter";
import styles from "./SupervisorHeadcount.module.css";

type Option = { id: string; name: string; buildingId?: string };
const LIVE_COLUMNS = ["Time", "Device", "RFID / QR", "Vehicle", "Owner", "Employee", "Visitor", "Company", "Action", "Result"] as const;

type ScanEvent = {
  id: string;
  action: string;
  code: string;
  message: string;
  cardNo: string;
  deviceNumber: string;
  createdAt: string;
  vehicle: { plateNumber: string; ownerName: string; department: string } | null;
  personType: "OWNER" | "EMPLOYEE" | "VISITOR" | "UNKNOWN";
  company: { name: string } | null;
};

type Headcount = {
  ok: true;
  buildingName: string;
  companyName: string | null;
  totalIn: number;
  totalOut: number;
  totalOnSite: number;
  activeCards: OverstayCard[];
  recentEvents: ScanEvent[];
  updatedAt: string;
};

function localDayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default function RealtimeMonitor({
  buildings,
  companies,
  fixedBuildingId,
  fixedCompanyId,
}: {
  buildings: Option[];
  companies: Option[];
  fixedBuildingId?: string | null;
  fixedCompanyId?: string | null;
}) {
  const [buildingId, setBuildingId] = useState(fixedBuildingId || buildings[0]?.id || "");
  const [companyId, setCompanyId] = useState(fixedCompanyId || "");
  const [visibleColumns, setVisibleColumns] = useState<Set<number>>(() => new Set(LIVE_COLUMNS.map((_, index) => index)));
  const [data, setData] = useState<Headcount | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState<Date | null>(null);
  const range = useMemo(localDayRange, []);
  const requestInFlight = useRef(false);
  const showScopeFilter = !fixedBuildingId;

  const visibleCompanies = useMemo(
    () => companies.filter((company) => !buildingId || company.buildingId === buildingId),
    [companies, buildingId],
  );

  useEffect(() => {
    if (companyId && !visibleCompanies.some((company) => company.id === companyId)) setCompanyId("");
  }, [buildingId, companyId, visibleCompanies]);

  const load = useCallback(async () => {
    if (!buildingId) {
      setData(null);
      setLoading(false);
      setError("Select a building to view realtime monitoring.");
      return;
    }
    if (requestInFlight.current || document.visibilityState !== "visible") return;
    requestInFlight.current = true;
    try {
      const params = new URLSearchParams({ ...range, buildingId });
      if (companyId) params.set("companyId", companyId);
      const response = await fetch(`/api/supervisor/headcount?${params.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.message || "Unable to load realtime monitor.");
      setData(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load realtime monitor.");
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [range, buildingId, companyId]);

  useEffect(() => {
    let stopped = false;
    let pollTimer: number | undefined;

    async function poll() {
      if (stopped) return;
      await load();
      if (!stopped) pollTimer = window.setTimeout(poll, 5000);
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };

    setLoading(true);
    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    setClock(new Date());
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => {
      stopped = true;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  return <>
    <OverstayAlert cards={data?.activeCards || []} enabled={Boolean(buildingId)} />

    {showScopeFilter ? <section className="portfolio-card building-management" style={{ marginTop: 19 }}>
      <div className="portfolio-header">
        <div>
          <div className="section-kicker">FILTER REALTIME DATA</div>
          <h2>Realtime monitor scope</h2>
          <p>Select a building and optionally a company. Data refreshes automatically every 5 seconds.</p>
        </div>
      </div>
      <div className="portfolio-divider" />
      <div className={styles.filterGrid}>
        <label className={styles.filterField}>
          <span>Building</span>
          <div className={styles.selectShell}>
            <select className={styles.modernSelect} value={buildingId} onChange={(event) => setBuildingId(event.target.value)}>
              <option value="">Select building</option>
              {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
            </select>
            <span className={styles.selectChevron} aria-hidden="true">⌄</span>
          </div>
        </label>
        <label className={styles.filterField}>
          <span>Company</span>
          <div className={styles.selectShell}>
            <select className={styles.modernSelect} value={companyId} disabled={Boolean(fixedCompanyId)} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">All companies</option>
              {visibleCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
            <span className={styles.selectChevron} aria-hidden="true">⌄</span>
          </div>
        </label>
      </div>
    </section> : null}

    <section className={`portfolio-card ${styles.headcount}`}>
      <div className={styles.titleRow}>
        <div>
          <div className="section-kicker"><span className={styles.liveDot} />REALTIME MONITOR</div>
          <h2>Realtime Head Count</h2>
          <p>{data ? `${data.buildingName}${data.companyName ? ` · ${data.companyName}` : " · All companies"}` : "Select scope above"} · updates every 5 seconds</p>
        </div>
        <div className={styles.clock}><strong>{clock ? clock.toLocaleDateString() : "..."}</strong><span>{clock ? clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "..."}</span></div>
      </div>
      <div className="portfolio-divider" />
      {error ? <div className={`parking-feedback parking-feedback-error ${styles.error}`}>{error}</div> : null}
      {loading && !data ? <p><Spinner /> Loading realtime monitor…</p> : <div className={styles.totals} style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <article className={`${styles.totalCard} ${styles.onsite}`}><span>Total On Site</span><strong>{data?.totalOnSite ?? 0}</strong></article>
        <article className={`${styles.totalCard} ${styles.in}`}><span>Total IN</span><strong>{data?.totalIn ?? 0}</strong></article>
        <article className={`${styles.totalCard} ${styles.out}`}><span>Total OUT</span><strong>{data?.totalOut ?? 0}</strong></article>
      </div>}
    </section>

    <section className={`portfolio-card ${styles.scanTableCard}`}>
      <div className={styles.scanTableHeader}><div><div className="section-kicker">RFID ACTIVITY</div><h2>Live Dashboard</h2></div><TableColumnFilter columns={LIVE_COLUMNS} selected={visibleColumns} onChange={setVisibleColumns} /></div>
      <div className={styles.tableWrap}>
        <table className={styles.scanTable}>
          <thead><tr><th hidden={!visibleColumns.has(0)}>Time</th><th hidden={!visibleColumns.has(1)}>Device</th><th hidden={!visibleColumns.has(2)}>RFID / QR</th><th hidden={!visibleColumns.has(3)}>Vehicle</th><th hidden={!visibleColumns.has(4)}>Owner</th><th hidden={!visibleColumns.has(5)}>Employee</th><th hidden={!visibleColumns.has(6)}>Visitor</th><th hidden={!visibleColumns.has(7)}>Company</th><th hidden={!visibleColumns.has(8)}>Action</th><th hidden={!visibleColumns.has(9)}>Result</th></tr></thead>
          <tbody>{visibleColumns.size === 0 ? <tr><td className={styles.emptyTable}>Select a column to display the activity table.</td></tr> : data?.recentEvents?.length ? data.recentEvents.map((event) => <tr key={event.id}>
            <td hidden={!visibleColumns.has(0)}>{new Date(event.createdAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", month: "short", day: "2-digit" })}</td>
            <td hidden={!visibleColumns.has(1)}>{event.deviceNumber || "-"}</td>
            <td hidden={!visibleColumns.has(2)}>{event.cardNo || "-"}</td>
            <td hidden={!visibleColumns.has(3)}>{event.vehicle?.plateNumber || "-"}</td>
            <td hidden={!visibleColumns.has(4)} className={event.personType === "OWNER" ? styles.ownerPerson : undefined}>{event.personType === "OWNER" ? event.vehicle?.ownerName || "-" : "-"}</td>
            <td hidden={!visibleColumns.has(5)} className={event.personType === "EMPLOYEE" ? styles.employeePerson : undefined}>{event.personType === "EMPLOYEE" ? event.vehicle?.ownerName || "-" : "-"}</td>
            <td hidden={!visibleColumns.has(6)} className={event.personType === "VISITOR" ? styles.visitorPerson : undefined}>{event.personType === "VISITOR" ? event.vehicle?.ownerName || "-" : "-"}</td>
            <td hidden={!visibleColumns.has(7)}>{event.company?.name || "-"}</td>
            <td hidden={!visibleColumns.has(8)}><span className={`${styles.actionBadge} ${event.action === "ENTRY" ? styles.entryBadge : event.action === "EXIT" ? styles.exitBadge : styles.deniedBadge}`}>{event.action}</span></td>
            <td hidden={!visibleColumns.has(9)} className={event.code === "0000" ? styles.successResult : styles.deniedResult}>{event.deviceNumber === "MANUAL" && event.action === "EXIT" ? manualExitResult(event.message) : event.code === "0000" ? event.action === "ENTRY" ? "Entry allowed" : event.action === "EXIT" ? "Exit allowed" : event.message : event.message || "Denied"}</td>
          </tr>) : <tr><td colSpan={Math.max(visibleColumns.size, 1)} className={styles.emptyTable}>No RFID / QR activity has been recorded yet.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  </>;
}
