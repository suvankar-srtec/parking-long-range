"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFeedback } from "./FeedbackProvider";
import styles from "./SupervisorHeadcount.module.css";
import bulk from "./ActiveCardsDialog.module.css";

export type ActiveCard = {
  id: string; rfidCardNo: string; vehicleNumber: string; personName: string;
  personType: "OWNER" | "EMPLOYEE" | "VISITOR"; companyName: string;
  department: string; entryTime: string | null;
};

export default function ActiveCardsDialog({ cards, canRemove, onClose, onChanged }: {
  cards: ActiveCard[]; canRemove: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const allCheckbox = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(0);
  const { notify } = useFeedback();
  const selectedCards = useMemo(() => cards.filter(card => selected.has(card.id)), [cards, selected]);
  const allSelected = cards.length > 0 && selectedCards.length === cards.length;
  useEffect(() => {
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.current?.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => { if (allCheckbox.current) allCheckbox.current.indeterminate = selectedCards.length > 0 && !allSelected; }, [selectedCards.length, allSelected]);

  function toggle(id: string) {
    setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function remove(targets: ActiveCard[]) {
    if (busy.current || !canRemove || !targets.length) return;
    if (!window.confirm(`Remove ${targets.length} selected active ${targets.length === 1 ? "entry" : "entries"}? Supervisor requests require Admin or Super Admin approval.`)) return;
    busy.current = true; setPending(true); setCompleted(0);
    const succeeded = new Set<string>();
    let removed = 0, requested = 0;
    const errors: string[] = [];
    try {
      for (const card of targets) {
        try {
          const response = await fetch("/api/supervisor/manual-exit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: card.id }) });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.message || "Manual exit failed.");
          succeeded.add(card.id);
          if (result.requested) requested++; else removed++;
        } catch (error) { errors.push(`${card.vehicleNumber || card.rfidCardNo}: ${error instanceof Error ? error.message : "Unable to remove entry."}`); }
        setCompleted(value => value + 1);
      }
      setSelected(current => new Set([...current].filter(id => !succeeded.has(id))));
      if (removed || requested) notify([removed ? `${removed} removed.` : "", requested ? `${requested} approval requests submitted.` : ""].filter(Boolean).join(" "));
      if (errors.length) notify(`${errors.length} failed. ${errors[0]}`, "error");
      await onChanged();
    } finally { busy.current = false; setPending(false); }
  }
  return createPortal(<dialog ref={dialog} className={`${styles.activeCardsModal} ${bulk.dialog}`} aria-label="Active RFID and visitor QR entries" onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <div className={styles.activeCardsHeader}><div><div className="section-kicker">CURRENTLY ON SITE</div><h2>Active RFID / QR</h2><p>{cards.length} active entries currently inside.</p></div><button type="button" className={styles.popupClose} aria-label="Close active cards" disabled={pending} onClick={onClose}>&#215;</button></div>
    {canRemove && <div className={bulk.toolbar}><label><input ref={allCheckbox} type="checkbox" aria-label="Select all active cards" checked={allSelected} disabled={pending || !cards.length} onChange={() => setSelected(allSelected ? new Set() : new Set(cards.map(card => card.id)))} />Select all</label><span>{selectedCards.length} selected</span><button type="button" className={styles.manualExitButton} disabled={pending || !selectedCards.length} onClick={() => void remove(selectedCards)}>{pending ? `Processing ${completed}...` : `Remove selected (${selectedCards.length})`}</button></div>}
    <div className={styles.activeCardsTableWrap}><table className={styles.activeCardsTable} aria-busy={pending}>
      <thead><tr>{canRemove && <th>Select</th>}<th>RFID / QR</th><th>Vehicle</th><th>Person</th><th>Type</th><th>Company</th><th>Department / Accessory</th><th>Entry time</th><th>Action</th></tr></thead>
      <tbody>{cards.length ? cards.map(card => <tr key={card.id}>
        {canRemove && <td data-label="Select"><input type="checkbox" aria-label={`Select ${card.vehicleNumber || card.rfidCardNo}`} checked={selected.has(card.id)} disabled={pending} onChange={() => toggle(card.id)} /></td>}
        <td data-label="RFID / QR">{card.rfidCardNo}</td><td data-label="Vehicle">{card.vehicleNumber}</td><td data-label="Person">{card.personName}</td><td data-label="Type">{card.personType === "OWNER" ? "Owner" : card.personType === "VISITOR" ? "Visitor" : "Employee"}</td><td data-label="Company">{card.companyName}</td><td data-label="Department / Accessory">{card.department}</td><td data-label="Entry time">{card.entryTime ? new Date(card.entryTime).toLocaleString() : "-"}</td><td data-label="Action">{canRemove ? <button type="button" className={styles.manualExitButton} disabled={pending} onClick={() => void remove([card])}>Remove</button> : "-"}</td>
      </tr>) : <tr><td colSpan={canRemove ? 9 : 8}>No active entries currently on site.</td></tr>}</tbody>
    </table></div>
  </dialog>, document.body);
}
