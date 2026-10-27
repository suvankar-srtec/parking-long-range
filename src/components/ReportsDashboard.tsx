"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./ReportsDashboard.module.css";

type ScopeOption = { id: string; name: string; buildingId?: string };
type ReportRow = {
  id: string;
  entityKey: string;
  buildingId: string | null;
  buildingName: string;
  companyId: string | null;
  companyName: string;
  accessType: "Vehicle" | "Visitor";
  vehicleNumber: string;
  rfidUid: string;
  rider: string;
  department: string;
  accessory: string;
  inTime: string;
  outTime: string | null;
  exitType: string;
  parkedFor: string;
  status: "Inside" | "Exited";
};

type ColumnKey =
  | "accessType"
  | "vehicleNumber"
  | "rfidUid"
  | "rider"
  | "buildingName"
  | "companyName"
  | "department"
  | "accessory"
  | "inTime"
  | "outTime"
  | "exitType"
  | "parkedFor"
  | "status";

type ColumnDefinition = {
  key: ColumnKey;
  label: string;
  pdfWidth: number;
  value: (row: ReportRow) => string;
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

const COLUMN_DEFINITIONS: ColumnDefinition[] = [
  { key: "accessType", label: "Type", pdfWidth: 8, value: (row) => row.accessType },
  { key: "vehicleNumber", label: "Vehicle number", pdfWidth: 13, value: (row) => row.vehicleNumber },
  { key: "rfidUid", label: "RFID / QR", pdfWidth: 12, value: (row) => row.rfidUid },
  { key: "rider", label: "Person", pdfWidth: 14, value: (row) => row.rider },
  { key: "buildingName", label: "Building", pdfWidth: 16, value: (row) => row.buildingName },
  { key: "companyName", label: "Company", pdfWidth: 16, value: (row) => row.companyName },
  { key: "department", label: "Department", pdfWidth: 14, value: (row) => row.department },
  { key: "accessory", label: "Accessory", pdfWidth: 12, value: (row) => row.accessory },
  { key: "inTime", label: "IN time", pdfWidth: 20, value: (row) => formatDateTime(row.inTime) },
  { key: "outTime", label: "OUT time", pdfWidth: 20, value: (row) => formatDateTime(row.outTime) },
  { key: "exitType", label: "Exit type", pdfWidth: 24, value: (row) => row.exitType },
  { key: "parkedFor", label: "Parked for", pdfWidth: 10, value: (row) => row.parkedFor },
  { key: "status", label: "Status", pdfWidth: 10, value: (row) => row.status },
];

const ALL_COLUMN_KEYS = COLUMN_DEFINITIONS.map((column) => column.key);

function withinDate(value: string, from: string, to: string) {
  const time = new Date(value).getTime();
  if (from && time < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && time > new Date(`${to}T23:59:59.999`).getTime()) return false;
  return true;
}

function indiaDateKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function spanDuration(from: string, to: string | null) {
  const milliseconds = Math.max((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime(), 0);
  const totalMinutes = Math.floor(milliseconds / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function firstInLastOutRows(rows: ReportRow[]) {
  const groups = new Map<string, {
    first: ReportRow;
    lastOut: string | null;
    lastExitType: string;
    lastPunchAt: number;
    lastStatus: ReportRow["status"];
  }>();

  for (const row of rows) {
    const groupKey = `${row.entityKey}|${indiaDateKey(row.inTime)}`;
    const inAt = new Date(row.inTime).getTime();
    const outAt = row.outTime ? new Date(row.outTime).getTime() : null;
    const punchAt = outAt ?? inAt;
    const existing = groups.get(groupKey);

    if (!existing) {
      groups.set(groupKey, {
        first: row,
        lastOut: row.outTime,
        lastExitType: row.exitType,
        lastPunchAt: punchAt,
        lastStatus: row.status,
      });
      continue;
    }

    if (inAt < new Date(existing.first.inTime).getTime()) existing.first = row;
    if (outAt !== null && (!existing.lastOut || outAt > new Date(existing.lastOut).getTime())) {
      existing.lastOut = row.outTime;
      existing.lastExitType = row.exitType;
    }
    if (punchAt >= existing.lastPunchAt) {
      existing.lastPunchAt = punchAt;
      existing.lastStatus = row.status;
    }
  }

  return Array.from(groups.entries()).map(([groupKey, group]) => ({
    ...group.first,
    id: `first-last:${groupKey}`,
    outTime: group.lastOut,
    exitType: group.lastOut ? group.lastExitType : "-",
    parkedFor: spanDuration(group.first.inTime, group.lastOut),
    status: group.lastStatus,
  })).sort((a, b) => new Date(b.inTime).getTime() - new Date(a.inTime).getTime());
}

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pdfEscape(value: string) {
  return value
    .replace(/[^\x20-\x7E]/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function fitPdfCell(value: string, width: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= width) return text.padEnd(width, " ");
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function buildPdfBlob(pages: string[][]) {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const contentIds = pages.map((_, index) => 5 + index * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";

  pages.forEach((lines, index) => {
    const pageId = pageIds[index];
    const contentId = contentIds[index];
    const streamLines = ["BT", "/F1 7 Tf", "1 0 0 1 24 565 Tm"];
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) streamLines.push("0 -11 Td");
      streamLines.push(`(${pdfEscape(line)}) Tj`);
    });
    streamLines.push("ET");
    const stream = streamLines.join("\n");

    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReportsDashboard({
  role,
  rows,
  buildings,
  companies,
}: {
  role: string;
  rows: ReportRow[];
  buildings: ScopeOption[];
  companies: ScopeOption[];
}) {
  const router = useRouter();
  const [browserReady, setBrowserReady] = useState(false);
  useEffect(() => setBrowserReady(true), []);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [buildingId, setBuildingId] = useState(role === "SUPER_ADMIN" ? "" : buildings[0]?.id || "");
  const [companyId, setCompanyId] = useState(role === "COMPANY_ADMIN" ? companies[0]?.id || "" : "");
  const [reportType, setReportType] = useState<"firstInLastOut" | "vehicle" | "visitor" | "exitPending" | "exitPendingTime">("firstInLastOut");
  const [pending24Hours, setPending24Hours] = useState(true);
  const [pending48Hours, setPending48Hours] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<ColumnKey>>(() => new Set(ALL_COLUMN_KEYS));

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);

  const allowedCompanies = useMemo(() => {
    if (!buildingId) return companies;
    return companies.filter((company) => company.buildingId === buildingId);
  }, [buildingId, companies]);

  const scopedRows = useMemo(() => rows.filter((row) => {
    if (buildingId && row.buildingId !== buildingId) return false;
    if (companyId === "__owner__") {
      if (row.companyId || row.accessType !== "Vehicle") return false;
    } else if (companyId === "__visitor__") {
      if (row.companyId || row.accessType !== "Visitor") return false;
    } else if (companyId && row.companyId !== companyId) return false;
    if (!withinDate(row.inTime, fromDate, toDate)) return false;
    return true;
  }), [rows, buildingId, companyId, fromDate, toDate]);

  const filtered = useMemo(() => {
    if (reportType === "firstInLastOut") return firstInLastOutRows(scopedRows);

    return scopedRows.filter((row) => {
      if (reportType === "vehicle" && row.accessType !== "Vehicle") return false;
      if (reportType === "visitor" && row.accessType !== "Visitor") return false;
      if (reportType === "exitPending" && row.status !== "Inside") return false;
      if (reportType === "exitPendingTime") {
        if (row.status !== "Inside") return false;
        const elapsedHours = (Date.now() - new Date(row.inTime).getTime()) / 3600000;
        if (!pending24Hours && !pending48Hours) return false;
        if (pending24Hours && pending48Hours) return elapsedHours >= 24;
        if (pending24Hours) return elapsedHours >= 24 && elapsedHours < 48;
        if (pending48Hours) return elapsedHours >= 48;
      }
      return true;
    });
  }, [scopedRows, reportType, pending24Hours, pending48Hours]);

  const visibleColumns = useMemo(
    () => COLUMN_DEFINITIONS
      .filter((column) => visibleColumnKeys.has(column.key))
      .map((column) => reportType === "firstInLastOut"
        ? {
            ...column,
            label: column.key === "inTime" ? "1st IN time" : column.key === "outTime" ? "Last OUT time" : column.label,
          }
        : column),
    [visibleColumnKeys, reportType],
  );

  const inside = filtered.filter((row) => row.status === "Inside").length;
  const exited = filtered.filter((row) => row.status === "Exited").length;
  const reportTitle = reportType === "firstInLastOut"
    ? "1st IN / Last OUT"
    : reportType === "exitPending"
    ? "Exit Pending"
    : reportType === "exitPendingTime"
      ? "Exit Pending with time"
      : reportType === "visitor"
        ? "Visitor IN / OUT time"
        : "Vehicle IN / OUT time";

  function clearFilters() {
    setFromDate("");
    setToDate("");
    if (role === "SUPER_ADMIN") setBuildingId("");
    if (role !== "COMPANY_ADMIN") setCompanyId("");
  }

  function toggleColumn(key: ColumnKey) {
    setVisibleColumnKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        if (next.size === 1) return current;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function downloadExcel() {
    const headers = visibleColumns.map((column) => column.label);
    const body = filtered.map((row) => visibleColumns.map((column) => column.value(row)));
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr>${body.map((values) => `<tr>${values.map((value) => `<td>${htmlEscape(value)}</td>`).join("")}</tr>`).join("")}</table></body></html>`;
    downloadBlob(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }), `parking-report-${new Date().toISOString().slice(0, 10)}.xls`);
  }

  function downloadPdf() {
    const headerLine = visibleColumns
      .map((column) => fitPdfCell(column.label.toUpperCase(), column.pdfWidth))
      .join(" | ");
    const separatorLine = visibleColumns
      .map((column) => "-".repeat(column.pdfWidth))
      .join("-+-");
    const dataLines = filtered.map((row) => visibleColumns
      .map((column) => fitPdfCell(column.value(row), column.pdfWidth))
      .join(" | "));

    const buildingName = buildingId ? buildings.find((building) => building.id === buildingId)?.name || "Selected building" : "All buildings";
    const companyName = companyId === "__owner__"
      ? "Building owner"
      : companyId === "__visitor__"
        ? "Building visitors"
        : companyId
        ? companies.find((company) => company.id === companyId)?.name || "Selected company"
        : "All companies";
    const dateRange = `${fromDate || "Any date"} to ${toDate || "Any date"}`;
    const pageRows = 38;
    const chunks: string[][] = [];
    if (dataLines.length === 0) {
      chunks.push([]);
    } else {
      for (let index = 0; index < dataLines.length; index += pageRows) {
        chunks.push(dataLines.slice(index, index + pageRows));
      }
    }

    const pages = chunks.map((chunk, index) => [
      `Parking report - ${reportTitle}`,
      `Generated ${new Date().toLocaleString()} | Records ${filtered.length} | Page ${index + 1}/${chunks.length}`,
      `Date: ${dateRange} | Building: ${buildingName} | Company/Owner: ${companyName}`,
      "",
      headerLine,
      separatorLine,
      ...(chunk.length ? chunk : ["No parking records match the selected filters."]),
    ]);

    downloadBlob(buildPdfBlob(pages), `parking-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  return <>
    <section className={styles.reportToolbar}>
      <div>
        <strong>{reportTitle}</strong>
        <span>Generated {browserReady ? new Date().toLocaleString() : "..."} · Auto-updating every 3 seconds</span>
      </div>
      <div className={styles.toolbarActions}>
        <select value={reportType} onChange={(event) => setReportType(event.target.value as "firstInLastOut" | "vehicle" | "visitor" | "exitPending" | "exitPendingTime")} aria-label="Report type">
          <option value="firstInLastOut">1st IN / Last OUT</option>
          <option value="vehicle">Vehicle IN / OUT time</option>
          <option value="visitor">Visitor IN / OUT time</option>
          <option value="exitPending">Exit Pending</option>
          <option value="exitPendingTime">Exit Pending with time</option>
        </select>
        {reportType === "exitPendingTime" ? <div className={styles.pendingTimeFilters} aria-label="Exit pending duration">
          <label><input type="checkbox" checked={pending24Hours} onChange={(event) => setPending24Hours(event.target.checked)} /><span>24 hr</span></label>
          <label><input type="checkbox" checked={pending48Hours} onChange={(event) => setPending48Hours(event.target.checked)} /><span>48 hr</span></label>
        </div> : null}
        <button type="button" onClick={downloadExcel}>Excel</button>
        <button type="button" onClick={downloadPdf}>PDF</button>
      </div>
    </section>

    <section className={styles.filters}>
      <label>From date<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label>To date<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      {role === "SUPER_ADMIN" && <label>Building<select value={buildingId} onChange={(event) => { setBuildingId(event.target.value); setCompanyId(""); }}><option value="">All buildings</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>}
      {role !== "COMPANY_ADMIN" && <label>Company / owner<select value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">All companies</option><option value="__owner__">Building owner</option><option value="__visitor__">Building visitors</option>{allowedCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
      {role === "COMPANY_ADMIN" && <label>Company<select value={companyId} disabled>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
      <button className={styles.clearButton} type="button" onClick={clearFilters}>Clear filter</button>
    </section>

    <section className={styles.summaryGrid}>
      <div><span>Records</span><strong>{filtered.length}</strong></div>
      <div><span>Currently inside</span><strong>{inside}</strong></div>
      <div><span>Exited</span><strong>{exited}</strong></div>
    </section>

    <section className={styles.reportTableCard}>
      <div className={styles.tableHeader}><strong>{reportTitle}</strong>
      <div className={styles.columnFilter}>
        <details className={styles.columnPicker}>
          <summary className={styles.iconTrigger} aria-label="Choose report columns" title="Choose report columns"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></svg></summary>
          <div className={styles.columnMenu}>
            {COLUMN_DEFINITIONS.map((column) => {
              const checked = visibleColumnKeys.has(column.key);
              return <label key={column.key}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={checked && visibleColumnKeys.size === 1}
                  onChange={() => toggleColumn(column.key)}
                />
                <span>{column.label}</span>
              </label>;
            })}
          </div>
        </details>
      </div>
      </div>
      <div className={`${styles.tableWrap} ${role === "EMPLOYEE" ? styles.supervisorReport : ""}`}>
        <table>
          <thead><tr>{visibleColumns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>{filtered.length ? filtered.map((row) => <tr key={row.id}>
            {visibleColumns.map((column) => <td key={column.key}>{column.key === "status" ? <span className={row.status === "Inside" ? styles.inside : styles.exited}>{row.status}</span> : !browserReady && (column.key === "inTime" || column.key === "outTime") ? "..." : column.value(row)}</td>)}
          </tr>) : <tr><td colSpan={visibleColumns.length}>No parking records match the selected filters.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  </>;
}
