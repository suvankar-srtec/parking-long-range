"use client";

import { useEffect, useState } from "react";
import Link from "@/components/AppLink";
import { readerStatus, type ReaderConnection } from "@/lib/reader-status";

type SidebarReader = ReaderConnection & {
  id: string;
  name?: string;
  deviceNumber: string;
  readerProtocol?: string;
};

type ReaderResponse = {
  readers: SidebarReader[];
};

export default function SidebarReaderStatus({
  endpoint = "/api/rfid/readers",
  title = "RFID Reader",
  linkToAccess = true,
}: {
  endpoint?: string;
  title?: string;
  linkToAccess?: boolean;
}) {
  const [readers, setReaders] = useState<SidebarReader[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    async function load() {
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        const payload = await response.json() as ReaderResponse;
        if (!response.ok) throw new Error("Reader status unavailable.");
        if (!stopped) {
          setReaders(Array.isArray(payload.readers) ? payload.readers : []);
          setLoaded(true);
        }
      } catch {
        if (!stopped) setLoaded(true);
      }

      if (!stopped) timer = window.setTimeout(load, 5000);
    }

    void load();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [endpoint]);

  return <div className="sidebar-reader-status">
    {linkToAccess
      ? <Link href="/access-control" className="sidebar-reader-title">{title}</Link>
      : <span className="sidebar-reader-title">{title}</span>}
    {!loaded ? null : readers.length === 0 ? <span className="sidebar-reader-empty">No reader allotted</span> : readers.map((reader) => {
      const online = readerStatus(reader).tone === "online";
      const cloudInput = (reader.readerProtocol === "CLOUD_C" || reader.name?.startsWith("Cloud C "))
        && /-[AB]$/.test(reader.deviceNumber);
      const label = cloudInput
        ? reader.deviceNumber.endsWith("-A") ? "Reader A (IN/WG1)" : "Reader B (OUT/WG2)"
        : reader.name || "Reader";
      return <div className="sidebar-reader-item" key={reader.id} title={online ? "Heartbeat active" : "Heartbeat unavailable"}>
        <i className={online ? "online" : "offline"} aria-hidden="true" />
        <span>{label}</span>
      </div>;
    })}
    <style>{`
      .sidebar-reader-status{
        margin-top:auto;
        padding:10px 5px 2px;
        border-top:1px solid #d9e6f3;
        display:grid;
        gap:6px;
      }
      .sidebar-reader-title{
        color:#1769c2!important;
        text-decoration:none;
        font-size:9.5px;
        font-weight:900;
        line-height:1.2;
        letter-spacing:.35px;
        text-transform:uppercase;
      }
      .sidebar-reader-item{
        display:flex;
        align-items:center;
        gap:7px;
        min-height:24px;
        padding:4px 6px;
        border:1px solid #e3edf7;
        border-radius:7px;
        background:#f8fbff;
        color:#1769c2!important;
        font-size:9.5px;
        font-weight:650;
        line-height:1.2;
      }
      .sidebar-reader-item span{color:#1769c2!important}
      .sidebar-reader-item strong{
        font-weight:900;
        color:#0f4f97!important;
      }
      .sidebar-reader-item i{
        width:8px;
        height:8px;
        border-radius:50%;
        flex:0 0 8px;
        box-shadow:0 0 0 2px rgba(23,105,194,.08);
      }
      .sidebar-reader-item i.online{background:#20bf6b}
      .sidebar-reader-item i.offline{background:#e5484d}
      .sidebar-reader-empty{
        color:#7897b8!important;
        font-size:9px;
      }
    `}</style>
  </div>;
}
