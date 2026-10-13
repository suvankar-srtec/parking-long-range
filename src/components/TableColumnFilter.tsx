"use client";
import { useEffect, useId, useRef, useState } from 'react';
import styles from './TableColumnFilter.module.css';
export default function TableColumnFilter({ columns, selected, onChange }: { columns: readonly string[]; selected: Set<number>; onChange: (selected: Set<number>) => void }) {
 const [open,setOpen]=useState(false);const panelId=useId();const root=useRef<HTMLDivElement>(null);const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;function outside(event:PointerEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}function escape(event:KeyboardEvent){if(event.key==='Escape'){setOpen(false);button.current?.focus();}}document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
 return <div ref={root} className={styles.filter}>
  <button ref={button} type="button" className={styles.trigger} aria-label="Choose table columns" aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(value=>!value)}>
   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8z"/></svg><span>Columns</span>
  </button>
  {open && <div id={panelId} className={styles.panel} role="group" aria-label="Table columns"><strong>Show columns</strong>{columns.map((label,index)=><label key={label}><input type="checkbox" checked={selected.has(index)} onChange={event=>{const next=new Set(selected);if(event.target.checked)next.add(index);else next.delete(index);onChange(next);}}/>{label}</label>)}<button type="button" onClick={()=>onChange(new Set(columns.map((_,index)=>index)))}>Show all</button></div>}
 </div>;
}
