import styles from "./BuildingParkingSummary.module.css";

export default function BuildingParkingSummary({ total, owner, visitor, company, gates, allotted, available }: {
  total: number; owner: number; visitor: number; company: number; gates: number; allotted: number; available: number;
}) {
  const metrics = [
    { label: "Owner parking", value: owner },
    { label: "Visitor parking", value: visitor },
    { label: "Company parking", value: company },
    { label: "Maximum Gates", value: gates },
    { label: "Allotted", value: allotted },
    { label: "Available", value: available, available: true },
  ];
  return <dl className={styles.summary} aria-label="Building parking summary">
    <div className={styles.total}><dt>Total parking</dt><dd>{total.toLocaleString()}</dd><span aria-hidden="true">P</span></div>
    {metrics.map(metric => <div key={metric.label} className={`${styles.metric} ${metric.available ? styles.available : ""}`}>
      <dt>{metric.label}</dt><dd>{metric.value.toLocaleString()}</dd>
    </div>)}
  </dl>;
}
