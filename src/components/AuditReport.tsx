"use client";
import { useEffect, useRef, useState } from "react";
import type { AuditRow } from "@/lib/audit-report";
import { scanEventType } from "@/lib/rfid-display";
import styles from "./AuditReport.module.css";
const time=(value:string)=>new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"medium"}).format(new Date(value));
const label=(value:string)=>value.replaceAll("_"," ").replace(/^\/api\//,"").replaceAll("/"," / ");
function eventType(row:AuditRow){const event=(row.details as {after?:{id?:string;deviceNumber?:string}})?.after;return row.entityType==="rfid_events"&&event?.id&&event?.deviceNumber?(scanEventType({id:event.id,deviceNumber:event.deviceNumber})||"Manual"):row.source;}
const fieldName=(key:string)=>key.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ").replace(/^./,x=>x.toUpperCase()).replace(/rfid/ig,"RFID");
function visibleField(key:string){return !/(^id$|Id$|Hash$|password|token|secret|qrdata|payload|raw|packet|manifest|transaction|requestId|code$)/i.test(key);}
function readable(value:unknown):string {
 if(value===null||value===undefined||value==="")return "?";
 if(value==="[REDACTED]")return "Hidden for security";
 if(typeof value==="boolean")return value?"Yes":"No";
 if(Array.isArray(value))return value.map(readable).join(", ")||"None";
 if(typeof value==="object")return Object.entries(value as Record<string,unknown>).filter(([key])=>visibleField(key)).map(([key,item])=>`${fieldName(key)}: ${readable(item)}`).join("; ")||"?";
 if(typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value)))return time(value);
 return String(value);
}
function AuditEvidence({details}:{details:unknown}) {
 const evidence=details&&typeof details==="object"?details as Record<string,unknown>:{};
 const before=evidence.before&&typeof evidence.before==="object"?evidence.before as Record<string,unknown>:null;
 const after=evidence.after&&typeof evidence.after==="object"?evidence.after as Record<string,unknown>:null;
 const changed=Array.isArray(evidence.changedFields)?evidence.changedFields.filter((key):key is string=>typeof key==="string"):null;
 const keys=(before&&after&&changed?changed:Object.keys(after||before||{})).filter(visibleField);
 const metadata=Object.entries(evidence).filter(([key,value])=>!["before","after","changedFields","note"].includes(key)&&visibleField(key)&&value!==null&&value!==undefined);
 return <section className={styles.evidence}><h3>{before&&after?"Changes made":"Activity details"}</h3>
 {typeof evidence.note==="string"?<p className={styles.note}>{evidence.note}</p>:null}
 {keys.length?<div className={styles.evidenceRows}>{keys.map(key=><div key={key}><strong>{fieldName(key)}</strong>{before&&after?<span><small>Before</small>{readable(before[key])}<small>After</small>{readable(after[key])}</span>:<span>{readable((after||before)![key])}</span>}</div>)}</div>:null}
 {metadata.length?<dl>{metadata.map(([key,value])=><div key={key}><dt>{fieldName(key)}</dt><dd>{readable(value)}</dd></div>)}</dl>:null}
 {!keys.length&&!metadata.length?<p className={styles.note}>No additional details recorded.</p>:null}
 </section>;
}
export default function AuditReport(){
 const [rows,setRows]=useState<AuditRow[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const [selected,setSelected]=useState<AuditRow|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError("");const timer=setTimeout(async()=>{
  try{const response=await fetch("/api/audit-report",{cache:"no-store",signal:controller.signal});const body=await response.json();if(!response.ok)throw new Error(body.message);setRows(body.rows);}
  catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Unable to load records.");}
  finally{if(!controller.signal.aborted)setLoading(false);}
 },250);return()=>{clearTimeout(timer);controller.abort();};},[]);
 useEffect(()=>{if(!selected)return;const element=dialog.current;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";element?.showModal();return()=>{element?.close();document.body.style.overflow=overflow;};},[selected]);
 return <div className={styles.report}>
 {error?<p role="alert" className={styles.error}>{error}</p>:null}
 <section className={styles.records} aria-busy={loading}><div className={styles.tableHeader}><h2>Audit records</h2><span>{loading?"Loading...":`${rows.length} records`}</span></div>
 <table><thead><tr>{["Date and time","Activity","Account / source","Building / company","Result","Details"].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id}>
 <td data-label="Date and time"><time dateTime={row.occurredAt}>{time(row.occurredAt)}</time><small>#{row.id}</small></td><td data-label="Activity"><strong>{row.category}</strong><span>{label(row.action)}</span>{row.entityType?<small>{label(row.entityType)}</small>:null}</td><td data-label="Account / source"><strong>{row.actor}</strong><small>{row.actorRole?label(row.actorRole):eventType(row)}</small></td><td data-label="Building / company"><span>{row.buildingName||"System"}</span><small>{row.companyName}</small></td><td data-label="Result"><span className={styles.result}>{row.result}</span></td><td data-label="Details"><button aria-label={`View audit record ${row.id}`} onClick={()=>setSelected(row)}>View</button></td></tr>)}</tbody></table>
 {!loading&&!rows.length?<p className={styles.empty}>No audit records yet.</p>:null}
 </section>
 {selected?<dialog ref={dialog} className={styles.dialog} aria-labelledby="audit-detail-title" onCancel={()=>setSelected(null)} onClose={()=>setSelected(null)}><header><div><span className={styles.badge}>AUDIT #{selected.id}</span><h2 id="audit-detail-title">Record details</h2></div><button aria-label="Close audit details" onClick={()=>setSelected(null)}>Close</button></header><dl>{[["Occurred",time(selected.occurredAt)],["Recorded",time(selected.recordedAt)],["Category",selected.category],["Action",selected.action],["Account",selected.actor],["Role",selected.actorRole||"Not attributed"],["Building",selected.buildingName||"System"],["Company",selected.companyName||"-"],["Item type",label(selected.entityType||"Account action")],["Result",selected.result],["Source",selected.source]].map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><AuditEvidence details={selected.details} /></dialog>:null}
 </div>;
}
