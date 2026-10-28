"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "./LoadingIndicator";
import OverstayAlert, { type OverstayCard } from "./OverstayAlert";
import LiveVisitTable, { VISIT_COLUMNS as LIVE_COLUMNS } from "./LiveVisitTable";
import MonitorSummary from "./MonitorSummary";
import ActiveCardsDialog from "./ActiveCardsDialog";
import styles from "./SupervisorHeadcount.module.css";

type Option = { id: string; name: string; buildingId?: string };

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
  personType: "OWNER" | "EMPLOYEE" | "VISITOR" | "UNKNOWN";
  company: { name: string } | null;
};

type Headcount = {
  ok: true;
  buildingName: string;
  companyName: string | null;
  openingOnSite: number | null;
  totalIn: number;
  totalOut: number;
  totalOnSite: number;
  activeCards: OverstayCard[];
  canManualExit: boolean;
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
  const visibleColumns = useMemo(() => new Set(LIVE_COLUMNS.map((_, index) => index)), []);
  const [showActiveCards, setShowActiveCards] = useState(false);
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
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      setError(timedOut ? "" : err instanceof Error ? err.message : "Unable to load realtime monitor.");
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
      const started = Date.now();
      await load();
      if (!stopped) pollTimer = window.setTimeout(poll, Math.max(250, 2000 - (Date.now() - started)));
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
          <p>Select a building and optionally a company. Data refreshes automatically.</p>
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

    <MonitorSummary buildingName={data ? `${data.buildingName}${data.companyName ? ` - ${data.companyName}` : ""}` : "Select scope above"}
      clock={clock} error={error} totalOnSite={data?.totalOnSite ?? 0} totalIn={data?.totalIn ?? 0} totalOut={data?.totalOut ?? 0}
      loading={loading && !data} onViewActive={() => setShowActiveCards(true)} />
    {showActiveCards && <ActiveCardsDialog key={`${buildingId}:${companyId}`} cards={data?.activeCards || []} canRemove={!!data?.canManualExit} onClose={() => setShowActiveCards(false)} onChanged={load} />}

    <section className={`portfolio-card ${styles.scanTableCard}`}>
      <div className={styles.scanTableHeader}><h2>Live Dashboard</h2></div>
      <LiveVisitTable events={data?.recentEvents || []} visibleColumns={visibleColumns} />
    </section>
  </>;
}
