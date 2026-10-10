"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client-request";

type Status = { ok: boolean; enabled: boolean; configured: boolean; pending: number;
  acknowledged: number; history: number; lastAckAt?: string; lastError?: string };
export default function CloudCOfflineSettings({ serial }: { serial: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // Fetch only when expanded; controller status polling remains lightweight.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const load = () => requestJson<Status>("/api/rfid/cloudc-offline?serial=" + encodeURIComponent(serial), "GET", undefined, controller.signal)
      .then(setStatus).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    void load();
    const timer = setInterval(load, 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [open, serial]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    setPending(true); setError("");
    try {
      await requestJson("/api/rfid/cloudc-offline", "POST", { serial, enabled: submitter?.value !== "disable",
        slotStart: Number(form.get("slotStart")), slotCount: Number(form.get("slotCount")),
        timezone: Number(form.get("timezone")), utcOffsetMinutes: Number(form.get("utcOffsetMinutes")), confirmReserved: form.get("reserved") === "on" });
      setStatus(await requestJson<Status>("/api/rfid/cloudc-offline?serial=" + encodeURIComponent(serial)));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to configure offline memory."); }
    finally { setPending(false); }
  }
  return <div>
    <button type="button" className="secondary-button" aria-expanded={open} onClick={() => setOpen(v => !v)}>Offline memory</button>
    {open && <section aria-label="Offline controller memory">
      <p>Internet outage fallback uses controller memory. Keep the controller powered and set Access Check to Online first.</p>
      <p>Supports A as Entry and B as Exit in the same building. Offline registration, live parking limits, visitor QR, and newly changed blocks require the server. App cards expire after 24 hours without renewal.</p>
      {error && <p role="alert">{error}</p>}
      {status && <>
        <p>{status.enabled ? "Memory sync enabled" : "Memory sync disabled"} · {status.pending} commands pending · {status.history} history records saved</p>
        <p>Last command acknowledged: {status.lastAckAt ? new Date(status.lastAckAt).toLocaleString() : "None"}</p>
        {status.lastError && <p role="alert">{status.lastError}</p>}
        <form onSubmit={submit}>
          {!status.configured && <>
            <p>Reserve unused card slots and one unused timezone in the controller first. Existing data in those slots will be overwritten. The app leaves other slots unchanged.</p>
            <label>First unused card slot <input name="slotStart" type="number" min="0" max="59999" required /></label>
            <label>Reserved capacity <input name="slotCount" type="number" min="1" max="1000" required /></label>
            <label>Unused timezone index <input name="timezone" type="number" min="0" max="15" required /></label>
            <label>Controller clock UTC offset in minutes (0 for UTC, 330 for India) <input name="utcOffsetMinutes" type="number" min="-720" max="840" defaultValue="0" required /></label>
            <label><input name="reserved" type="checkbox" required /> These slots and timezone are unused and reserved for this app.</label>
          </>}
          <button className="secondary-button" type="submit" name="action" value="sync" disabled={pending}>Enable / retry sync</button>
          {status.configured && <button className="secondary-button" type="submit" name="action" value="disable" disabled={pending}>Disable and remove app cards</button>}
        </form>
      </>}
    </section>}
  </div>;
}
