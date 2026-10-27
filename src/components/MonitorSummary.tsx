import styles from "./MonitorSummary.module.css";

type Props = {
  buildingName: string; clock: Date | null; error?: string; loading?: boolean;
  totalOnSite: number | null; totalIn: number | null; totalOut: number | null;
  showTotalOnSite?: boolean; showTotalIn?: boolean; showTotalOut?: boolean;
  onViewActive?: () => void;
};

export default function MonitorSummary({ buildingName, clock, error, loading, totalOnSite, totalIn, totalOut,
  showTotalOnSite = true, showTotalIn = true, showTotalOut = true, onViewActive }: Props) {
  const metrics = [
    { label: "Total On Site", value: totalOnSite, show: showTotalOnSite, tone: "onsite", path: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 9h.01M15 9h.01M9 12h.01M15 12h.01", action: onViewActive },
    { label: "Total IN", value: totalIn, show: showTotalIn, tone: "entry", path: "M14 4h5v16h-5M3 12h11m-4-4 4 4-4 4" },
    { label: "Total OUT", value: totalOut, show: showTotalOut, tone: "exit", path: "M10 4H5v16h5m0-8h11m-4-4 4 4-4 4" },
  ].filter(metric => metric.show);
  return <section className={styles.panel} aria-label={`${buildingName} real time monitor`}>
    <header className={styles.header}>
      <div className={styles.date}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18" /></svg><time dateTime={clock?.toISOString()}>{clock ? clock.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "..."}</time></div>
      <div className={styles.clock}><span className={styles.dot} aria-hidden="true" /><time dateTime={clock?.toISOString()}>{clock ? clock.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).toUpperCase() : "..."}</time><span className={styles.zone}>IST</span></div>
    </header>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.metrics} style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }} aria-busy={loading}>
      {metrics.map(metric => {
        const content = <><div className={styles.metricHeader}><span className={styles.icon}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={metric.path} /></svg></span><span>{metric.label}</span></div><div className={styles.metricBody}><strong className={styles.value}>{loading ? "..." : (metric.value ?? 0).toLocaleString()}</strong>{metric.action ? <span className={styles.hint}>View active cards <span aria-hidden="true">&rarr;</span></span> : null}</div></>;
        const className = `${styles.metric} ${styles[metric.tone]}`;
        return metric.action ? <button key={metric.tone} type="button" className={className} onClick={metric.action}>{content}</button> : <article key={metric.tone} className={className}>{content}</article>;
      })}
    </div>
  </section>;
}
