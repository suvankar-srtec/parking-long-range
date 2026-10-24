"use client";

import { useMemo } from "react";
import { pairVisitScans, type VisitScan } from "@/lib/rfid-visits";
import { manualExitResult, scanResultMessage } from "@/lib/rfid-display";
import styles from "./SupervisorHeadcount.module.css";
import visitStyles from "./LiveVisitTable.module.css";

export const VISIT_COLUMNS = ["Entry time", "Exit time", "Device", "RFID / QR", "Vehicle", "Owner", "Employee", "Visitor", "Company", "Status", "Result", "Event Type"] as const;

function time(event: VisitScan | null) {
  return event ? new Date(event.createdAt).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}

export default function LiveVisitTable({ events, visibleColumns }: { events: VisitScan[]; visibleColumns: Set<number> }) {
  const rows = useMemo(() => pairVisitScans(events), [events]);
  return <div className={visitStyles.wrap}><table className={visitStyles.table}>
    <thead><tr>{VISIT_COLUMNS.map((label, index) => <th key={label} hidden={!visibleColumns.has(index)}>{label}</th>)}</tr></thead>
    <tbody>{!visibleColumns.size || !rows.length ? <tr><td colSpan={Math.max(visibleColumns.size, 1)} className={styles.emptyTable}>{visibleColumns.size ? "No RFID activity has been recorded yet." : "Select a column to display the activity table."}</td></tr> : rows.map(row => {
      const event = row.latest;
      const allowed = event.code === "0000";
      const status = row.exit ? "Exited" : row.entry ? "Inside" : event.action;
      const result = event.deviceNumber === "MANUAL" && event.action === "EXIT" ? manualExitResult(event.message) : allowed ? row.exit ? "Exit allowed" : row.entry ? "Entry allowed" : scanResultMessage(event.message) : scanResultMessage(event.message);
      const sources = row.entry && row.exit && row.entry.eventType !== row.exit.eventType ? `IN: ${row.entry.eventType || "—"} / OUT: ${row.exit.eventType || "—"}` : event.eventType || "—";
      const values = [
        time(row.entry), time(row.exit),
        row.entry && row.exit && row.entry.deviceNumber !== row.exit.deviceNumber ? `${row.entry.deviceNumber} / ${row.exit.deviceNumber}` : event.deviceNumber,
        event.cardNo, event.vehicle?.plateNumber,
        event.personType === "OWNER" ? event.vehicle?.ownerName : "-",
        event.personType === "EMPLOYEE" ? event.vehicle?.ownerName : "-",
        event.personType === "VISITOR" ? event.vehicle?.ownerName : "-",
        event.company?.name, status, result, sources,
      ];
      return <tr key={row.id}>{values.map((value, index) => <td key={VISIT_COLUMNS[index]} data-label={VISIT_COLUMNS[index]} hidden={!visibleColumns.has(index)} className={index === 10 ? allowed ? styles.successResult : styles.deniedResult : undefined}>
        {value || "—"}{index === 10 && !row.entry && !row.exit ? <small className={visitStyles.scanTime}>{time(event)}</small> : null}
      </td>)}</tr>;
    })}</tbody>
  </table></div>;
}
