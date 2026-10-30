"use client";
import { useEffect, useState } from "react";
import type { AuditRow } from "@/lib/audit-report";
import styles from "./AuditReport.module.css";
const dateFormat=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium"});
const timeFormat=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",timeStyle:"medium"});
const label=(value:string)=>value.replaceAll("_"," ").replace(/^\/api\//,"").replaceAll("/"," / ");
export default function AuditReport(){
 const [rows,setRows]=useState<AuditRow[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{
  const controller=new AbortController();let inFlight=false;
  async function load(){
   if(inFlight||controller.signal.aborted)return;
   inFlight=true;
   try{const response=await fetch("/api/audit-report",{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});const body=await response.json();if(!response.ok)throw new Error(body.message);if(!controller.signal.aborted){setRows(body.rows);setError("");}}
   catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Unable to load records.");}
   finally{inFlight=false;if(!controller.signal.aborted)setLoading(false);}
  }
  void load();const timer=window.setInterval(()=>void load(),10000);
  const refresh=()=>void load();window.addEventListener("audit-interactions-saved",refresh);
  return()=>{controller.abort();window.clearInterval(timer);window.removeEventListener("audit-interactions-saved",refresh);};
 },[]);
 return <div className={styles.report}>
 {error?<p role="alert" className={styles.error}>{error}</p>:null}
 <section className={styles.records} aria-busy={loading}>
 <table aria-label="Audit Report"><thead><tr>{["Date and time","Activity","Account / source","Building / company","Result"].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id}>
 <td data-label="Date and time"><time dateTime={row.occurredAt}><span>{dateFormat.format(new Date(row.occurredAt))}</span><span>{timeFormat.format(new Date(row.occurredAt))}</span></time><small>#{row.id}</small></td><td data-label="Activity"><strong>{row.category}</strong><span>{label(row.action)}</span></td><td data-label="Account / source"><strong>{row.actor}</strong>{row.actorRole?<small>{label(row.actorRole)}</small>:null}</td><td data-label="Building / company"><span>{row.buildingName||"System"}</span><small>{row.companyName}</small></td><td data-label="Result"><span className={styles.result}>{row.result}</span></td></tr>)}</tbody></table>
 {!loading&&!rows.length?<p className={styles.empty}>No audit records yet.</p>:null}
 </section>
 </div>;
}
