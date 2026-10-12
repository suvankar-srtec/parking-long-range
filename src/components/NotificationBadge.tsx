"use client";
import { useEffect, useState } from "react";
export default function NotificationBadge() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let fetching = false;
    async function load() {
      if (fetching) return; fetching = true;
      try {
        const response = await fetch("/api/notifications?summary=1", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (response.ok) { const data = await response.json(); if (!controller.signal.aborted) setUnread(data.unread || 0); }
      } catch {} finally { fetching = false; }
    }
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  return unread ? <span aria-label={`${unread} unread notifications`} style={{ background: "#e9f1fe", color: "#1769c2", borderRadius: 12, padding: "2px 6px", fontSize: 10 }}>{unread > 99 ? "99+" : unread}</span> : null;
}
