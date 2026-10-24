import styles from "./CompanyParkingSummary.module.css";

const icons = {
  capacity: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M9 17V7h4a3 3 0 0 1 0 6H9" /></>,
  visitor: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M19 8v6m-3-3h6" /></>,
  employee: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5" /></>,
  vehicle: <><path d="m4 10 2-6h12l2 6M3 10h18v8H3zM6 18v3m12-3v3M6 14h2m8 0h2" /></>,
  available: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
};

export default function CompanyParkingSummary({ limit, visitors, employees, vehicles, available }: {
  limit: number; visitors: number; employees: number; vehicles: number; available: number;
}) {
  const metrics = [
    { label: "Company limit", value: limit, icon: "capacity" },
    { label: "Visitor parking", value: visitors, icon: "visitor" },
    { label: "Total employees", value: employees, icon: "employee" },
    { label: "Registered vehicles", value: vehicles, icon: "vehicle" },
    { label: "Unassigned", value: available, icon: "available" },
  ] as const;
  return <dl className={styles.summary} aria-label="Company parking summary">
    {metrics.map(metric => <div key={metric.icon} className={`${styles.metric} ${styles[metric.icon]}`}>
      <div className={styles.heading}>
        <dt>{metric.label}</dt>
        <span className={styles.icon} aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[metric.icon]}</svg></span>
      </div>
      <dd>{metric.value.toLocaleString()}</dd>
    </div>)}
  </dl>;
}
