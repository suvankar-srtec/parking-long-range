"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pairVisitScans, filterVisitRows, type VisitRow, type VisitScan } from "@/lib/rfid-visits";
import { manualExitResult, scanResultMessage } from "@/lib/rfid-display";
import styles from "./SupervisorHeadcount.module.css";
import visitStyles from "./LiveVisitTable.module.css";

export const VISIT_COLUMNS = ["Entry time", "Exit time", "Device", "RFID / QR", "Vehicle", "Owner", "Employee", "Visitor", "Company", "Result", "Event Type"] as const;

const COLUMN_WIDTHS = [10, 10, 10, 7, 6, 7, 7, 6, 10, 10, 11];

function time(event: VisitScan | null) {
  if (!event) return "-";
  const date = new Date(event.createdAt);
  return <time dateTime={event.createdAt} className={visitStyles.timestamp}>
    <span>{date.toLocaleDateString([], { month: "short", day: "2-digit" })}</span>
    <span>{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
  </time>;
}

function ScanDetails({ row, onClose }: { row: VisitRow; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  const scans = [...(row.scans || [row.latest])].reverse();
  return createPortal(<dialog ref={dialog} className={visitStyles.scanDialog} aria-labelledby="scan-details-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className={visitStyles.dialogHeader}><div><h2 id="scan-details-title">{scanResultMessage(row.latest.message)}</h2><p>{row.latest.cardNo} <span className={visitStyles.scanBadge}>{scans.length} scans</span></p></div><button type="button" className={visitStyles.closeButton} onClick={onClose} aria-label="Close scan details">&#215;</button></header>
    <div className={visitStyles.scanList}>{scans.map((scan, index) => <article key={scan.id} className={visitStyles.scanDetail}>
      <div className={visitStyles.scanHeading}><strong>Scan {scans.length - index}</strong><time dateTime={scan.createdAt}>{new Date(scan.createdAt).toLocaleString()}</time></div>
      <dl>{[
        ["RFID / QR", scan.cardNo], ["Reader", scan.deviceNumber], ["Vehicle", scan.vehicle?.plateNumber],
        ["Name", scan.vehicle?.ownerName], ["Type", scan.personType], ["Company", scan.company?.name],
        ["Department", scan.vehicle?.department], ["Action", scan.action], ["Event type", scan.eventType],
        ["Result code", scan.code], ["Result", scan.message],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "-"}</dd></div>)}</dl>
    </article>)}</div>
  </dialog>, document.body);
}

export default function LiveVisitTable({ events, visibleColumns, searchQuery = "" }: { events: VisitScan[]; visibleColumns: Set<number>; searchQuery?: string }) {
  const [selected, setSelected] = useState<VisitRow | null>(null);
  const closeDetails = useCallback(() => setSelected(null), []);
  const visits = useMemo(() => pairVisitScans(events), [events]);
  const rows = useMemo(() => filterVisitRows(visits, searchQuery), [visits, searchQuery]);
  const totalWidth = COLUMN_WIDTHS.reduce((sum, width, index) => sum + (visibleColumns.has(index) ? width : 0), 0);
  return <>{selected && <ScanDetails row={selected} onClose={closeDetails} />}<div className={visitStyles.wrap}><table className={visitStyles.table}>
    <thead><tr>{VISIT_COLUMNS.map((label, index) => <th key={label} hidden={!visibleColumns.has(index)} style={{ width: totalWidth ? `${COLUMN_WIDTHS[index] / totalWidth * 100}%` : undefined }}>{label}</th>)}</tr></thead>
    <tbody>{!visibleColumns.size || !rows.length ? <tr><td colSpan={Math.max(visibleColumns.size, 1)} className={styles.emptyTable}>{visibleColumns.size ? searchQuery.trim() ? "No visits match your search." : "No RFID activity has been recorded yet." : "Select a column to display the activity table."}</td></tr> : rows.map(row => {
      const event = row.latest;
      const allowed = event.code === "0000";
      const result = event.deviceNumber === "MANUAL" && event.action === "EXIT" ? manualExitResult(event.message) : allowed ? row.exit ? "Exit allowed" : row.entry ? "Entry allowed" : scanResultMessage(event.message) : scanResultMessage(event.message);
      const sources = row.entry && row.exit && row.entry.eventType !== row.exit.eventType ? `IN: ${row.entry.eventType || "—"} / OUT: ${row.exit.eventType || "—"}` : event.eventType || "—";
      const values = [
        time(row.entry), time(row.exit),
        row.entry && row.exit && row.entry.deviceNumber !== row.exit.deviceNumber ? <span className={visitStyles.deviceLines}><span>{row.entry.deviceNumber}</span><span>{row.exit.deviceNumber}</span></span> : event.deviceNumber,
        event.cardNo, event.vehicle?.plateNumber,
        event.personType === "OWNER" ? event.vehicle?.ownerName : "-",
        event.personType === "EMPLOYEE" ? event.vehicle?.ownerName : "-",
        event.personType === "VISITOR" ? event.vehicle?.ownerName : "-",
        event.company?.name, result, sources,
      ];
      return <tr key={row.id}>{values.map((value, index) => <td key={VISIT_COLUMNS[index]} data-label={VISIT_COLUMNS[index]} hidden={!visibleColumns.has(index)} className={index === 9 ? allowed ? styles.successResult : styles.deniedResult : undefined}>
        {index === 9 ? row.scans && row.scans.length > 1 ? <button type="button" className={visitStyles.groupButton} onClick={() => setSelected(row)} aria-label={`${result}: ${row.scans.length} scans. View scan details`}><span>{result}</span><span className={visitStyles.scanBadge}>{row.scans.length}</span></button> : <span className={visitStyles.resultText}>{value || "-"}</span> : value || "-"}{index === 9 && !row.entry && !row.exit ? <small className={visitStyles.scanTime}>{time(event)}</small> : null}
      </td>)}</tr>;
    })}</tbody>
  </table></div></>;
}
