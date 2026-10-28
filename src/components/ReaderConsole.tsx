"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "@/components/AppLink";
import { readerStatus, readerServerClockOffset, type ReaderConnection } from "@/lib/reader-status";
import { requestJson } from "@/lib/client-request";
import { useFeedback, useMutation } from "./FeedbackProvider";
import { ActionButton, Spinner } from "./LoadingIndicator";

type Reader = ReaderConnection & {
  id: string;
  name: string;
  deviceNumber: string;
  mode: string;
  enabled: boolean;
  buildingId: string | null;
  readerIp: string | null;
  sourcePort: number | null;
  readerProtocol?: string;
  hasRegistrationQr?: boolean;
  hasEntryExitQr?: boolean;
  building?: { name: string } | null;
};

type ReaderData = {
  serverTime?: string;
  readers: Reader[];
  availableReaders: Reader[];
  buildings: { id: string; name: string }[];
  canManage: boolean;
  canAddReaders: boolean;
  canAssignReaders?: boolean;
  canConfigureReaders?: boolean;
  canRemoveReaders?: boolean;
};

type Activity = { inside: number };

const MAX_QR_FILE_BYTES = 1_100_000;

function readQrImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/i)) {
      reject(new Error("Please select a PNG, JPG, or WEBP QR image."));
      return;
    }
    if (file.size > MAX_QR_FILE_BYTES) {
      reject(new Error("QR image is too large. Please use an image smaller than 1 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The QR image could not be read."));
    reader.readAsDataURL(file);
  });
}

function softwareReader(reader: Reader) { return reader.readerProtocol === "CLOUD_C" || reader.readerProtocol === "UHF_MM"; }

function normalizedMode(mode: string) {
  if (mode === "REGISTER" || mode === "ENTRY" || mode === "EXIT") return mode;
  return "UNASSIGNED";
}

function modeLabel(mode: string) {
  if (mode === "REGISTER") return "Registration";
  if (mode === "ENTRY") return "Entry";
  if (mode === "EXIT") return "Exit";
  if (mode === "ENTRY_EXIT") return "Entry / Exit";
  return "Purpose not configured";
}

function qrKindForMode(mode: string) {
  return mode === "REGISTER" ? "registration" : "entryExit";
}

function hasQrForMode(reader: Reader, mode: string) {
  return mode === "REGISTER" ? Boolean(reader.hasRegistrationQr) : Boolean(reader.hasEntryExitQr);
}

function storedQrUrl(reader: Reader, mode: string, revision: number) {
  const kind = qrKindForMode(mode);
  return `/api/rfid/readers/${encodeURIComponent(reader.deviceNumber)}/qr?kind=${kind}&v=${revision}`;
}

export default function ReaderConsole({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<ReaderData | null>(null);
  const [activity, setActivity] = useState<Activity>({ inside: 0 });
  const [error, setError] = useState(false);
  const [summaryDelayed, setSummaryDelayed] = useState(false);
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [editing, setEditing] = useState<Reader | null>(null);
  const [editingMode, setEditingMode] = useState("ENTRY");
  const [showAvailable, setShowAvailable] = useState(false);
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  const [selectedReader, setSelectedReader] = useState<Reader | null>(null);
  const [setupMode, setSetupMode] = useState("ENTRY");
  const [registrationQr, setRegistrationQr] = useState("");
  const [entryExitQr, setEntryExitQr] = useState("");
  const [revision, setRevision] = useState(0);
  const [deviceSearch, setDeviceSearch] = useState("");
  const { notify } = useFeedback();
  const { pending, execute } = useMutation();

  useEffect(() => {
    let stopped = false;
    let failed = false;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      async function getJson<T>(url: string): Promise<T> {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "Status unavailable.");
        return payload as T;
      }
      const [readerResult, activityResult] = await Promise.allSettled([
        getJson<ReaderData>("/api/rfid/readers").then(devices => ({ devices, offset: readerServerClockOffset(devices.serverTime) })),
        compact ? Promise.resolve(null) : getJson<Activity>("/api/rfid/events?summary=1"),
      ]);
      if (stopped) return;
      if (readerResult.status === "fulfilled") {
        setData(readerResult.value.devices);
        setServerClockOffset(readerResult.value.offset);
        setError(false);
        failed = false;
      } else {
        setError(true);
        if (!compact && !failed) {
          const cause = readerResult.reason;
          const message = cause instanceof Error && cause.name === "TimeoutError"
            ? "Reader status refresh took too long. Retrying automatically."
            : "Reader status could not refresh. Retrying automatically.";
          notify(message, "error");
        }
        failed = true;
      }
      if (activityResult.status === "fulfilled") {
        if (activityResult.value) setActivity({ inside: Number(activityResult.value.inside || 0) });
        setSummaryDelayed(false);
      } else {
        setSummaryDelayed(true);
      }
      timer = setTimeout(load, 5000);
    }

    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [compact, revision, notify]);

  function openAddReader() {
    setSelectedReader(null);
    setRegistrationQr("");
    setEntryExitQr("");
    setSetupMode("ENTRY");
    setSetupStep(1);
    setShowAvailable(true);
  }

  function closeAddReader() {
    if (pending) return;
    setShowAvailable(false);
    setSelectedReader(null);
    setRegistrationQr("");
    setEntryExitQr("");
    setSetupMode("ENTRY");
    setSetupStep(1);
  }

  function openConfigure(reader: Reader) {
    setEditing(reader);
    setEditingMode(normalizedMode(reader.mode));
    setRegistrationQr("");
    setEntryExitQr("");
  }

  async function pickQr(event: ChangeEvent<HTMLInputElement>, kind: "registration" | "entryExit") {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readQrImage(file);
      if (kind === "registration") setRegistrationQr(dataUrl);
      else setEntryExitQr(dataUrl);
    } catch (cause) {
      event.target.value = "";
      notify(cause instanceof Error ? cause.message : "Unable to read the QR image.", "error");
    }
  }

  if (compact) {
    return <div className="reader-panel">
      <Link href="/access-control" className="reader-heading">RFID readers</Link>
      {error ? <p>Status unavailable</p> : !data ? <p>Loading readers…</p> : !data.readers.length ? <p>No readers configured</p> : data.readers.map((reader) => {
        const state = readerStatus(reader, Date.now() + serverClockOffset);
        return <div className="reader-line" key={reader.id}>
          <i className={"reader-dot " + state.tone} />
          <span>{reader.name} · {reader.deviceNumber}<small>{state.label}</small></span>
        </div>;
      })}
    </div>;
  }

  function saveExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void execute(async () => {
      const result = await requestJson("/api/rfid/readers", "POST", {
        ...(softwareReader(editing!) ? { action: "configureSoftware" } : {}),
        deviceNumber: editing!.deviceNumber,
        mode: editingMode,
        ...(registrationQr ? { registrationQrData: registrationQr } : {}),
        ...(entryExitQr ? { entryExitQrData: entryExitQr } : {}),
      });
      notify(result.message || "Reader saved.");
      setEditing(null);
      setRevision((n) => n + 1);
    });
  }

  function allowReader(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!selectedReader) {
      notify(data?.canAssignReaders ? "Select a detected reader first." : "Select an allotted reader first.", "error");
      return;
    }
    void execute(async () => {
      const result = data?.canAssignReaders
        ? await requestJson("/api/rfid/readers", "POST", {
            action: "assign",
            deviceNumber: selectedReader.deviceNumber,
            name: form.get("name"),
            buildingId: form.get("buildingId"),
          })
        : await requestJson("/api/rfid/readers", "POST", {
            ...(softwareReader(selectedReader) ? { action: "configureSoftware" } : {}),
            deviceNumber: selectedReader.deviceNumber,
            mode: setupMode,
            ...(registrationQr ? { registrationQrData: registrationQr } : {}),
            ...(entryExitQr ? { entryExitQrData: entryExitQr } : {}),
          });
      notify(result.message || (data?.canAssignReaders ? "Reader allotted successfully." : "Reader added successfully."));
      setShowAvailable(false);
      setSelectedReader(null);
      setRegistrationQr("");
      setEntryExitQr("");
      setSetupMode("ENTRY");
      setSetupStep(1);
      setRevision((n) => n + 1);
    });
  }

  function removeReader(reader: Reader) {
    if (!window.confirm(data?.canAssignReaders
      ? `Remove the building allotment for ${reader.name} (${reader.deviceNumber})? Any gate assignment will also be cleared.`
      : `Remove ${reader.name} (${reader.deviceNumber}) from active configuration? It will remain allotted to this building and can be added again.`)) return;
    void execute(async () => {
      const result = await requestJson("/api/rfid/readers", "POST", {
        action: "reset",
        deviceNumber: reader.deviceNumber,
      });
      notify(result.message || "Reader removed.");
      setRevision((n) => n + 1);
    });
  }

  function renderReader(reader: Reader, controllerInput = false) {
    if (controllerInput) {
      const state = error ? { tone: "unknown", label: "Unavailable" } : readerStatus(reader, Date.now() + serverClockOffset);
      const input = reader.deviceNumber.endsWith("-A") ? "A" : "B";
      return <article className="controller-input-row" key={reader.id}>
        <div className="controller-input-identity"><span className="controller-input-letter">{input}</span>
          <div><h3>Reader {input} <small>{input === "A" ? "IN / WG1" : "OUT / WG2"}</small></h3>
            <span className="controller-input-device">{reader.deviceNumber}</span></div></div>
        <div className="controller-input-purpose"><span>{modeLabel(normalizedMode(reader.mode))}</span>
          <small><i className={"reader-dot " + state.tone} />{state.label}{!reader.enabled ? " ? Disabled" : ""}</small></div>
        <div className="controller-input-actions">
          {(data!.canConfigureReaders || data!.canAssignReaders) && <button type="button" className="controller-action" onClick={() => openConfigure(reader)} aria-label={`Configure reader ${reader.deviceNumber}`}>Configure</button>}
          {data!.canRemoveReaders && <button type="button" className="controller-action controller-action-remove" disabled={pending} onClick={() => removeReader(reader)} aria-label={`Remove reader ${reader.deviceNumber}`}>Remove</button>}
        </div>
      </article>;
    }


          const state = error ? { tone: "unknown", label: "Status unavailable" } : readerStatus(reader, Date.now() + serverClockOffset);
          return <article className="reader-card" key={reader.id}>
            {reader.readerProtocol === "UHF_MM" ? <p className="muted">UHF network reader - Software-controlled purpose</p> : null}
            <h3>{reader.readerProtocol === "CLOUD_C" && /-[AB]$/.test(reader.deviceNumber) ? `Reader ${reader.deviceNumber.endsWith("-A") ? "A (IN/WG1)" : "B (OUT/WG2)"}` : reader.name}</h3>
            <p>{reader.deviceNumber} · {reader.readerIp || "IP not detected"}</p>
            <div className="reader-line"><i className={"reader-dot " + state.tone} />{state.label}</div>
            <p>{data!.buildings.find((building) => building.id === reader.buildingId)?.name || "Building not assigned"} · {modeLabel(normalizedMode(reader.mode))}</p>
            <p className="muted">{reader.enabled ? "Approved" : "Disabled"} · Last contact: {reader.lastSeenAt ? new Date(reader.lastSeenAt).toLocaleString() : "None"}</p>
            {softwareReader(reader) ? null : <p className="muted">Setup QR: {reader.hasRegistrationQr ? "Registration ✓" : "Registration missing"} · {reader.hasEntryExitQr ? "Entry / Exit ✓" : "Entry / Exit missing"}</p>}
            {(data!.canConfigureReaders || data!.canRemoveReaders || (data!.canAssignReaders && softwareReader(reader))) && <div className="reader-card-actions">
              {(data!.canConfigureReaders || (data!.canAssignReaders && softwareReader(reader))) ? <button className="secondary-button" onClick={() => openConfigure(reader)}>Configure purpose</button> : null}
              {data!.canRemoveReaders ? <button className="secondary-button" disabled={pending} onClick={() => removeReader(reader)}>Remove reader</button> : null}
            </div>}
          </article>;

  }

  const groups = new Map<string, { serial: string | null; readers: Reader[] }>();
  for (const reader of data?.readers ?? []) {
    const serial = reader.readerProtocol === "CLOUD_C" && /-[AB]$/.test(reader.deviceNumber)
      ? reader.deviceNumber.slice(0, -2) : null;
    const key = serial ? "controller:" + serial : "reader:" + reader.id;
    const group = groups.get(key) ?? { serial, readers: [] };
    group.readers.push(reader);
    groups.set(key, group);
  }

  const visibleGroups = [...groups.entries()].filter(([, group]) => !deviceSearch.trim()
    || group.readers.some(reader => [group.serial, reader.deviceNumber, reader.name, reader.readerIp, reader.building?.name]
      .some(value => value?.toLowerCase().includes(deviceSearch.trim().toLowerCase()))));

  const editingQr = editingMode === "REGISTER" ? registrationQr : entryExitQr;

  return <>
    <section className="portfolio-card">
      <div className="reader-toolbar reader-toolbar-top controller-toolbar">
        <div className="controller-toolbar-title"><h2>Controllers &amp; readers</h2><span>{[...groups.values()].filter(group => group.serial).length} controllers / {data?.readers.length ?? 0} readers</span></div>
        <input className="controller-search" type="search" aria-label="Search controllers or readers" placeholder="Search controller or reader" value={deviceSearch} onChange={event => setDeviceSearch(event.target.value)} />
        {data?.canAddReaders && <button className="secondary-button" type="button" onClick={openAddReader}>+ Add reader</button>}
        <strong>{activity.inside} vehicles inside</strong>
      </div>

      {summaryDelayed && <p className="muted" role="status">Parking totals refresh delayed. Retrying automatically.</p>}
      {!data ? <p><Spinner /> Loading readers…</p> : <div className="reader-grid controller-grid">
        {visibleGroups.map(([key, group]) => {
          if (!group.serial) return renderReader(group.readers[0]);
          return <section key={key} className="controller-card" aria-label={`Controller ${group.serial}`}>
            <header className="controller-card-head"><h2>Cloud C {group.serial}</h2></header>
            <div className="controller-reader-grid">{group.readers.map(reader => renderReader(reader, true))}</div>
          </section>;
        })}
        {!visibleGroups.length && <p className="muted">{deviceSearch ? "No controllers or readers match your search." : "No readers configured."}</p>}
      </div>}
    </section>

    {showAvailable && <div className="modal-backdrop reader-modal-backdrop">
      <section className="modal-card reader-selector-modal" role="dialog" aria-modal="true" aria-label="Add RFID reader">
        <div className="modal-head reader-selector-head">
          <div>
            <div className="section-kicker">{data?.canAssignReaders ? "ALLOT RFID READER" : "ADD ALLOTTED READER"} · STEP {setupStep} OF 2</div>
            <h2>{setupStep === 1 ? "Select reader" : data?.canAssignReaders ? "Allot reader" : "Configure reader"}</h2>
            <p>{setupStep === 1
              ? data?.canAssignReaders
                ? "Choose an unassigned physical reader."
                : "Choose a reader already allotted to your building by Super Admin."
              : data?.canAssignReaders
                ? "Choose the building that will own this reader. The Building Admin will configure its purpose."
                : "Choose Registration or Entry / Exit for this allotted reader."}</p>
          </div>
          <button className="modal-close" disabled={pending} aria-label="Close add reader" onClick={closeAddReader}>×</button>
        </div>

        {setupStep === 1 && <>
          {!data?.availableReaders?.length ? <p className="muted reader-selector-empty">{data?.canAssignReaders
            ? "No unassigned readers are currently available. Power on a reader and make sure its HTTPS URL is pointing to this application."
            : "No additional reader is currently allotted to your building. Super Admin must allot a reader first."}</p> : <div className="reader-selector-list">
            {data.availableReaders.map((reader) => {
              const state = readerStatus(reader, Date.now() + serverClockOffset);
              const selected = selectedReader?.id === reader.id;
              return <button type="button" className={`reader-selector-row${selected ? " selected" : ""}`} key={reader.id} onClick={() => { setSelectedReader(reader); setSetupMode("REGISTER"); }}>
                <div className="reader-selector-main">
                  <div className="reader-selector-title">
                    <i className={"reader-dot " + state.tone} />
                    <strong>Device {reader.deviceNumber}</strong>
                  </div>
                  <div className="reader-selector-meta">
                    <span><b>IP</b>{reader.readerIp || "Not detected"}</span>
                    <span><b>Status</b>{state.label}</span>
                    <span><b>Last contact</b>{reader.lastSeenAt ? new Date(reader.lastSeenAt).toLocaleString() : "None"}</span>
                  </div>
                </div>
                <span className="reader-selector-action">{selected ? "Selected ✓" : "Select"}</span>
              </button>;
            })}
          </div>}
          <div className="modal-actions reader-selector-actions">
            <button type="button" className="secondary-button" onClick={closeAddReader}>Cancel</button>
            <button type="button" className="primary-button" disabled={!selectedReader} onClick={() => setSetupStep(2)}>Next</button>
          </div>
        </>}

        {setupStep === 2 && selectedReader && <form className="reader-setup-form" onSubmit={allowReader}>
          <div className="reader-device-strip">
            <div><span>Device</span><strong>{selectedReader.deviceNumber}</strong></div>
            <div><span>IP address</span><strong>{selectedReader.readerIp || "Not detected"}</strong></div>
          </div>

          {data?.canAssignReaders ? <>
            <fieldset className="reader-setup-fields reader-allot-fields" disabled={pending}>
              <label>Name<input name="name" defaultValue={selectedReader.name || `Reader ${selectedReader.deviceNumber}`} required /></label>
              <label>Building<select name="buildingId" defaultValue="" required><option value="">Select building</option>{data?.buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>
            </fieldset>
            <div className="reader-allot-note">
              <strong>Purpose will be configured by the Building Admin</strong>
              <span>Registration, Entry, or Exit can be selected only after this reader is allotted to the building.</span>
            </div>
          </> : <>
            <fieldset className="reader-setup-fields reader-admin-add-fields" disabled={pending}>
              <label>Name<input value={selectedReader.name} readOnly /></label>
              <label>Building<input value={selectedReader.building?.name || data?.buildings.find((building) => building.id === selectedReader.buildingId)?.name || "Assigned building"} readOnly /></label>
              <label>Purpose<select value={setupMode} onChange={(event) => setSetupMode(event.target.value)}>
                <option value="REGISTER">Registration</option>
                <option value="ENTRY">Entry</option><option value="EXIT">Exit</option>
                <option value="UNASSIGNED" disabled>Select role</option>
              </select></label>
            </fieldset>
            <div className="reader-setup-body reader-admin-setup-body">
              {!softwareReader(selectedReader) && <label className="reader-qr-upload">
                <span>{setupMode === "REGISTER" ? "Registration QR" : "Entry / Exit QR"}</span>
                <div className="reader-upload-row">
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void pickQr(event, setupMode === "REGISTER" ? "registration" : "entryExit")} />
                  {(setupMode === "REGISTER" ? registrationQr : entryExitQr)
                    ? <img src={setupMode === "REGISTER" ? registrationQr : entryExitQr} alt="Configuration QR preview" />
                    : <em>Optional</em>}
                </div>
              </label>}
              <div className="reader-allot-note">
                <strong>Only allotted readers are available here</strong>
                <span>This reader is already tied to your building. Adding it only activates its selected purpose.</span>
              </div>
            </div>
          </>}

          <div className="modal-actions reader-compact-actions">
            <button type="button" className="secondary-button" disabled={pending} onClick={() => setSetupStep(1)}>Back</button>
            <ActionButton type="submit" className="primary-button" pending={pending} pendingText={data?.canAssignReaders ? "Allotting…" : "Adding…"}>{data?.canAssignReaders ? "Allot reader" : "Add reader"}</ActionButton>
          </div>
        </form>}
      </section>
    </div>}

    {editing && <div className="modal-backdrop reader-modal-backdrop">
      <section className="modal-card reader-config-modal" role="dialog" aria-modal="true" aria-label="Configure reader">
        <div className="modal-head reader-config-head">
          <div><div className="section-kicker">READER SETTINGS</div><h2>Configure {editing.deviceNumber}</h2><p>{editing.readerIp || "IP not detected"}</p></div>
          <button className="modal-close" disabled={pending} aria-label="Close reader settings" onClick={() => setEditing(null)}>×</button>
        </div>

        <form className="reader-config-form" onSubmit={saveExisting}>
          <fieldset className="reader-config-fields" disabled={pending}>
            <label>Device number<input value={editing.deviceNumber} readOnly /></label>
            <label>Name<input value={editing.name} readOnly /></label>
            <label>Building<input value={data?.buildings.find((building) => building.id === editing.buildingId)?.name || "Assigned building"} readOnly /></label>
            <label>Purpose<select name="mode" value={editingMode} onChange={(event) => setEditingMode(event.target.value)}>
              <option value="REGISTER">Registration</option>
              <option value="ENTRY">Entry</option><option value="EXIT">Exit</option>
              <option value="UNASSIGNED" disabled>Select role</option>
            </select></label>
            {!softwareReader(editing) && <label className="reader-config-upload">
              {editingMode === "REGISTER" ? "Registration QR" : "Entry / Exit QR"}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void pickQr(event, editingMode === "REGISTER" ? "registration" : "entryExit")} />
            </label>}
          </fieldset>

          {!softwareReader(editing) && <div className="reader-qr-preview reader-config-qr">
            <div>
              <span className="section-kicker">CONFIGURATION QR</span>
              <strong>{modeLabel(editingMode)}</strong>
            </div>
            {editingQr ? <img src={editingQr} alt={`${modeLabel(editingMode)} configuration QR preview`} /> : hasQrForMode(editing, editingMode) ? <img src={storedQrUrl(editing, editingMode, revision)} alt={`${modeLabel(editingMode)} reader configuration QR`} /> : <div className="reader-qr-placeholder">QR not uploaded</div>}
            <small>{editingQr || hasQrForMode(editing, editingMode) ? "Scan this QR with the physical reader if the hardware mode needs updating." : `Upload the ${modeLabel(editingMode)} QR if required by the hardware.`}</small>
          </div>}

          <div className="modal-actions reader-compact-actions">
            <button type="button" className="secondary-button" disabled={pending} onClick={() => setEditing(null)}>Cancel</button>
            <ActionButton type="submit" className="primary-button" pending={pending} pendingText="Saving…">Save reader</ActionButton>
          </div>
        </form>
      </section>
    </div>}

    <style>{`
      .controller-toolbar{gap:12px;margin-bottom:18px}.controller-toolbar-title{margin-right:auto}.controller-toolbar-title h2{font-size:16px;margin:0 0 3px}.controller-toolbar-title span{color:#768699;font-size:11px}.controller-search{width:230px;max-width:100%;padding:8px 10px;border:1px solid #d5dfeb;border-radius:7px;background:#fff;font-size:12px}
      .controller-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr));gap:14px}
      .controller-card{border:1px solid #dbe4ef;border-radius:10px;background:#fff;min-width:0;overflow:hidden;box-shadow:0 2px 6px rgba(20,48,80,.035)}
      .controller-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 15px;background:#f7faff;border-bottom:1px solid #e4ebf3}
      .controller-heading{display:flex;align-items:center;gap:10px;min-width:0}.controller-icon{display:grid;place-items:center;width:34px;height:34px;border:1px solid #d7e5f5;border-radius:8px;background:#edf4fe;color:#246ac2;font-size:23px}
      .controller-card-head h2{margin:0;font-size:14px;font-weight:750}.controller-card-head h2 span{font-weight:600}.controller-card-head p{margin:4px 0 0;color:#78869a;font-size:10px}
      .controller-status{display:inline-flex;align-items:center;gap:5px;padding:4px 7px;border-radius:6px;font-size:10px;white-space:nowrap;background:#f0f4f8;color:#64748b}.controller-status.online{background:#ecf8f2;color:#168453}.controller-status.offline{background:#fff0f0;color:#bf4141}
      .controller-reader-grid{display:grid;grid-template-columns:1fr}.controller-input-row{display:grid;grid-template-columns:minmax(125px,1fr) minmax(100px,.8fr) auto;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid #edf1f6}.controller-input-row:last-child{border-bottom:0}
      .controller-input-identity{display:flex;align-items:center;gap:8px;min-width:0}.controller-input-letter{display:grid;place-items:center;flex-shrink:0;width:27px;height:27px;border-radius:6px;background:#eef3fa;color:#3d628d;font-size:12px;font-weight:750}.controller-input-identity h3{font-size:12px;margin:0 0 3px}.controller-input-identity h3 small{font-size:9px;font-weight:400;color:#8793a4;margin-left:3px}.controller-input-device{color:#8692a3;font-size:10px}
      .controller-input-purpose{display:grid;gap:4px;font-size:11px;color:#3d536e}.controller-input-purpose small{display:flex;align-items:center;gap:4px;font-size:9px;color:#8491a2}.controller-input-purpose .reader-dot,.controller-status .reader-dot{width:6px;height:6px}
      .controller-input-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.controller-action{border:1px solid #d6e2f1;border-radius:5px;padding:5px 7px;background:#f7faff;color:#33629a;cursor:pointer;font-size:10px}.controller-action:hover{background:#edf4ff;border-color:#a6c1e3}.controller-action-remove{color:#8b6d77;background:#fff;border-color:#e5dfe3}.controller-action:disabled{opacity:.5;cursor:wait}
      .controller-card-footer{display:flex;justify-content:space-between;gap:8px;padding:8px 15px;background:#fbfcfe;border-top:1px solid #edf1f6;color:#8a97a7;font-size:9px}
      @media(max-width:560px){.controller-toolbar-title{width:100%}.controller-search{flex:1}.controller-input-row{grid-template-columns:1fr auto;gap:8px}.controller-input-purpose{grid-column:1;grid-row:2;padding-left:35px}.controller-input-actions{grid-column:2;grid-row:1/3}.controller-card-head,.controller-input-row{padding:11px}.controller-card-footer{padding:8px 11px}}
      .reader-toolbar,.reader-card-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .reader-toolbar-top{justify-content:flex-end;margin-bottom:12px}
      .reader-modal-backdrop{padding:12px}
      .reader-selector-modal,.reader-config-modal{overflow:visible;max-height:none;border-radius:12px;box-shadow:0 24px 70px rgba(20,34,27,.22)}
      .reader-selector-modal{width:min(760px,96vw);padding:16px 18px 14px}
      .reader-config-modal{width:min(760px,96vw);padding:16px 18px 14px}
      .reader-selector-head,.reader-config-head{align-items:flex-start;padding-bottom:10px;border-bottom:1px solid #e0e7e3}
      .reader-selector-head h2,.reader-config-head h2{font-size:17px;margin:2px 0 2px}
      .reader-selector-head p,.reader-config-head p{font-size:10.5px;line-height:1.35}
      .reader-selector-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px;overflow:visible}
      .reader-selector-row{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border:1px solid #d7e1db;border-radius:8px;background:#fbfdfc;color:#25372e;text-align:left;cursor:pointer;transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}
      .reader-selector-row:hover{border-color:#b9c9c0;background:#fff;box-shadow:0 4px 12px rgba(31,52,40,.06)}
      .reader-selector-row.selected{border-color:#8b50b9;background:#faf7fc;box-shadow:0 0 0 2px rgba(139,80,185,.09)}
      .reader-selector-main{min-width:0;flex:1}.reader-selector-title{display:flex;align-items:center;gap:6px}.reader-selector-title strong{font-size:12px}.reader-selector-title .reader-dot{width:7px;height:7px}
      .reader-selector-meta{display:flex;gap:5px 10px;flex-wrap:wrap;margin-top:5px;color:#738078;font-size:8.5px;line-height:1.2}.reader-selector-meta span{display:inline-flex;gap:3px;white-space:nowrap}.reader-selector-meta b{color:#536159;font-size:7.5px;text-transform:uppercase}
      .reader-selector-action{flex:0 0 auto;min-width:62px;padding:5px 7px;border:1px solid #d7dfda;border-radius:6px;background:#fff;color:#53645b;font-size:9px;font-weight:800;text-align:center}.reader-selector-row.selected .reader-selector-action{border-color:#d4bee5;background:#eee5f5;color:#6d3998}
      .reader-selector-empty{margin:12px 0 0;padding:12px;border:1px dashed #d7dfda;border-radius:8px;background:#fafcfb;font-size:10.5px;text-align:center}
      .reader-selector-actions{margin-top:10px;padding-top:10px}.reader-selector-actions .secondary-button,.reader-selector-actions .primary-button,.reader-compact-actions .secondary-button,.reader-compact-actions .primary-button{min-width:76px;padding:7px 11px;font-size:11px}

      .reader-setup-form{display:grid;gap:10px;margin-top:10px}
      .reader-device-strip{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 10px;border:1px solid #d8e1dc;border-radius:8px;background:#f8faf9}
      .reader-device-strip div{display:flex;align-items:center;gap:7px;min-width:0}.reader-device-strip span{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#758078}.reader-device-strip strong{font-size:11px;color:#22362b;overflow-wrap:anywhere}
      .reader-setup-fields,.reader-config-fields{margin:0;padding:0;border:0;display:grid;gap:9px}
      .reader-setup-fields{grid-template-columns:repeat(3,minmax(0,1fr))}.reader-allot-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.reader-admin-add-fields{grid-template-columns:repeat(3,minmax(0,1fr))}.reader-admin-setup-body{grid-template-columns:minmax(0,1fr) minmax(260px,1fr)}.reader-allot-note{display:grid;gap:3px;padding:10px 11px;border:1px solid #d8e1dc;border-radius:8px;background:#f8faf9;color:#31453a}.reader-allot-note strong{font-size:11px}.reader-allot-note span{font-size:9.5px;color:#758078}.reader-config-upload{grid-column:1/-1}
      .reader-setup-fields label,.reader-config-fields label{display:grid;gap:5px;color:#31453a;font-size:10.5px;font-weight:800}
      .reader-setup-fields input,.reader-setup-fields select,.reader-config-fields input,.reader-config-fields select{width:100%;height:36px;border:1px solid #ccd8d1;border-radius:7px;background:#fff;padding:7px 9px;outline:none;font-size:11px}
      .reader-setup-fields input:focus,.reader-setup-fields select:focus,.reader-config-fields input:focus,.reader-config-fields select:focus{border-color:#7c46ac;box-shadow:0 0 0 2px rgba(124,70,172,.09)}
      .reader-config-fields input[readonly]{background:#f4f2f7;color:#6c6179}
      .reader-setup-body{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(220px,.75fr);gap:10px;align-items:stretch}
      .reader-upload-column{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .reader-qr-upload{display:grid;gap:6px;padding:9px;border:1px solid #d8e1dc;border-radius:8px;background:#fbfdfc;color:#31453a;font-size:10.5px;font-weight:800}
      .reader-upload-row{display:grid;grid-template-columns:minmax(0,1fr) 54px;gap:7px;align-items:center}.reader-upload-row input{min-width:0;width:100%;font-size:9px}.reader-upload-row img{width:54px;height:54px;object-fit:contain;border:1px solid #dde4df;border-radius:6px;background:#fff}.reader-upload-row em{display:grid;place-items:center;width:54px;height:54px;border:1px dashed #d8e1dc;border-radius:6px;color:#919c96;font-size:8px;font-style:normal;text-align:center}
      .reader-qr-preview{display:grid;grid-template-columns:minmax(0,1fr) 122px;grid-template-rows:auto 1fr;gap:5px 9px;align-items:center;padding:9px 10px;border:1px solid #d8e1dc;border-radius:8px;background:#f8faf9;min-width:0}.reader-qr-preview>div:first-child{align-self:end}.reader-qr-preview strong{display:block;margin-top:2px;font-size:13px}.reader-qr-preview img,.reader-qr-placeholder{grid-column:2;grid-row:1/3;width:122px;height:122px;border:1px solid #dce3df;border-radius:7px;background:#fff;object-fit:contain}.reader-qr-placeholder{display:grid;place-items:center;padding:8px;color:#7b8780;font-size:9px;text-align:center}.reader-qr-preview small{align-self:start;color:#758078;font-size:9px;line-height:1.3}
      .reader-compact-actions{margin-top:0;padding-top:9px}

      .reader-config-form{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(250px,.75fr);gap:11px 12px;margin-top:10px}
      .reader-config-fields{grid-template-columns:repeat(2,minmax(0,1fr));align-content:start}
      .reader-config-fields .reader-enabled{grid-column:1/-1;display:flex;align-items:center;gap:7px;min-height:30px;padding:5px 8px;border:1px solid #d8e1dc;border-radius:7px;background:#f8faf9}.reader-config-fields .reader-enabled input{width:15px;height:15px;padding:0}.reader-config-fields .reader-enabled span{font-size:10.5px}
      .reader-config-qr{grid-template-columns:minmax(0,1fr) 138px}.reader-config-qr img,.reader-config-qr .reader-qr-placeholder{width:138px;height:138px}.reader-config-form>.reader-compact-actions{grid-column:1/-1}

      @media(max-width:760px){
        .reader-selector-modal,.reader-config-modal{width:min(620px,96vw)}
        .reader-selector-list{grid-template-columns:1fr}
        .reader-setup-fields{grid-template-columns:1fr 1fr}.reader-setup-fields label:last-child{grid-column:1/-1}
        .reader-setup-body,.reader-config-form{grid-template-columns:1fr}
        .reader-config-qr{grid-column:auto}.reader-config-form>.reader-compact-actions{grid-column:auto}
      }
      @media(max-width:560px){
        .reader-modal-backdrop{padding:8px;align-items:start;overflow:auto}
        .reader-selector-modal,.reader-config-modal{margin-top:8px;padding:13px;max-height:none}
        .reader-setup-fields,.reader-config-fields,.reader-device-strip,.reader-upload-column{grid-template-columns:1fr}
        .reader-setup-fields label:last-child,.reader-config-fields .reader-enabled{grid-column:auto}
        .reader-qr-preview,.reader-config-qr{grid-template-columns:1fr;text-align:center}.reader-qr-preview img,.reader-qr-placeholder,.reader-config-qr img,.reader-config-qr .reader-qr-placeholder{grid-column:1;grid-row:auto;margin:0 auto;width:118px;height:118px}
      }
    `}</style>
  </>;
}
