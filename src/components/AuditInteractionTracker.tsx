"use client";
import { useEffect } from "react";
import { auditPage, interfaceLabels, type InterfaceAction } from "@/lib/audit-interactions";
type Interaction={id:string;action:InterfaceAction;page:string;at:string};
export default function AuditInteractionTracker(){
 useEffect(()=>{
  let queue:Interaction[]=[],sending=false,stopped=false;
  async function flush(){
   if(sending||!queue.length||stopped)return;
   sending=true;const batch=queue.splice(0,30);
   try{const response=await fetch("/api/audit-report/interactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({events:batch}),keepalive:true});
    if(response.ok)window.dispatchEvent(new Event("audit-interactions-saved"));
    else if(response.status!==401&&response.status!==403)queue.unshift(...batch);
   }catch{queue.unshift(...batch);}finally{sending=false;}
  }
  function interactionId(){
   if(typeof crypto.randomUUID==="function")return crypto.randomUUID();
   const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
   const hex=Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  function record(action:InterfaceAction){
   // The sign-in screen is covered by login outcome auditing, not click telemetry.
   if(window.location.pathname==="/")return;
   queue.push({id:interactionId(),action,page:auditPage(window.location.pathname),at:new Date().toISOString()});
   if(queue.length>=20||action==="signout")void flush();
  }
  function click(event:MouseEvent){
   if(!(event.target instanceof Element)||!event.isTrusted)return;
   const element=event.target.closest<HTMLElement>('button,a,input,select,summary,[role="button"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"]');
   if(!element)return;
   let action:InterfaceAction=element.tagName==="A"?"link":element.tagName==="SUMMARY"?"menu":"button";
   if(element instanceof HTMLInputElement){record(element.type==="checkbox"?"checkbox":element.type==="radio"?"radio":"field");return;}
   if(element instanceof HTMLSelectElement){record("select");return;}
   const texts=[element.getAttribute("aria-label")||"",element.textContent||""].map(text=>text.replace(/[+\u2192\u2190]/g,"").replace(/\s+/g," ").trim().toLowerCase());
   const named=texts.map(text=>interfaceLabels[text]).find(Boolean);
   if(named)action=named;
   else if(/^remove gate\b/.test(texts[0]))action="removeGate";
   else if(/^add gate\b/.test(texts[0]))action="addGate";
   else if(/^close\b/.test(texts[0]))action="close";
   else if(/^show .+ details$/.test(texts[0]))action="showCompanyDetails";
   else if(/^hide .+ details$/.test(texts[0]))action="hideCompanyDetails";
   record(action);
  }
  function change(event:Event){if(event.isTrusted&&event.target instanceof HTMLSelectElement)record("selection");}
  function leave(){while(queue.length){const batch=queue.splice(0,30);if(!navigator.sendBeacon("/api/audit-report/interactions",new Blob([JSON.stringify({events:batch})],{type:"application/json"}))){queue.unshift(...batch);break;}}}
  function visibility(){if(document.visibilityState==="hidden")leave();}
  const timer=window.setInterval(()=>void flush(),1000);
  document.addEventListener("click",click,true);document.addEventListener("change",change,true);window.addEventListener("pagehide",leave);document.addEventListener("visibilitychange",visibility);
  return()=>{leave();stopped=true;window.clearInterval(timer);document.removeEventListener("click",click,true);document.removeEventListener("change",change,true);window.removeEventListener("pagehide",leave);document.removeEventListener("visibilitychange",visibility);};
 },[]);
 return null;
}
