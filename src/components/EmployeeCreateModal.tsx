"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { checkForm, requestJson } from "@/lib/client-request";
import { useFeedback, useMutation } from "./FeedbackProvider";
import { ActionButton } from "./LoadingIndicator";
import DepartmentPicker from "./DepartmentPicker";
import CardCapture, { type CapturedCard } from "./CardCapture";

type DepartmentOption = { id: string; name: string };
export type CreatedEmployee = {
  id: string;
  name: string;
  userId: string;
  category: string;
  parkingLimit: number;
  department: string;
};

const vehicleTypes = ["Two wheeler", "Four wheeler"];

export default function EmployeeCreateModal({
  companyId,
  departments,
  maximumDepartments: _maximumDepartments,
  canManageVehicles = true,
  canRegisterRfid = true,
  registration,
  disabled = false,
  triggerLabel = "Add Employee",
  triggerClassName = "add-building-button",
  showTriggerIcon = true,
}: {
  companyId: string;
  departments: DepartmentOption[];
  maximumDepartments: number; // retained for backward-compatible callers; department creation is unlimited
  canManageVehicles?: boolean;
  canRegisterRfid?: boolean;
  registration?: { employee: CreatedEmployee; buildingId: string; vehicle?: { id: string; plateNumber: string; isInside: boolean } };
  disabled?: boolean;
  triggerLabel?: string;
  triggerClassName?: string;
  showTriggerIcon?: boolean;
}) {
  const modalId = useId();
  const existingEmployee = registration?.employee;
  const { notify, refresh } = useFeedback();
  const { pending: saving, execute } = useMutation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [generatedUserId, setGeneratedUserId] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [generatingUserId, setGeneratingUserId] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [idRefresh, setIdRefresh] = useState(0);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>(departments);
  const [department, setDepartment] = useState(departments[0]?.name || "");
  const [newDepartment, setNewDepartment] = useState("");
  const [addingDepartment, setAddingDepartment] = useState(false);
  const [departmentBusy, setDepartmentBusy] = useState(false);
  const [createdEmployee, setCreatedEmployee] = useState<CreatedEmployee | null>(null);
  const [createdNotice, setCreatedNotice] = useState<CreatedEmployee | null>(null);
  const [vehicleCard, setVehicleCard] = useState<CapturedCard | null>(null);
  const requestVersion = useRef(0);
  const reservationRef = useRef("");
  const pending = saving || departmentBusy || addingDepartment;

  useEffect(() => {
    setDepartmentOptions(departments);
  }, [departments]);

  useEffect(() => {
    if (!createdNotice) return;
    const timer = window.setTimeout(() => setCreatedNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [createdNotice]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  function show() {
    setCreatedNotice(null);
    setName(existingEmployee?.name || "");
    setGeneratedUserId(existingEmployee?.userId || "");
    setReservationId("");
    reservationRef.current = "";
    setGeneratingUserId(false);
    setGenerationError("");
    setDepartmentOptions(departments);
    setDepartment(departments.some(item => item.name === existingEmployee?.department) ? existingEmployee!.department : departments[0]?.name || "");
    setNewDepartment("");
    setCreatedEmployee(null);
    setVehicleCard(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setCreatedEmployee(null);
    setVehicleCard(null);
    refresh();
  }

  useEffect(() => {
    const version = ++requestVersion.current;
    const cleanName = name.trim();
    if (existingEmployee) return;
    if (!open || createdEmployee || !cleanName) {
      if (!createdEmployee) {
        setGeneratedUserId("");
        setReservationId("");
        reservationRef.current = "";
        setGeneratingUserId(false);
        setGenerationError("");
      }
      return;
    }

    const controller = new AbortController();
    const previousReservationId = reservationRef.current;
    setGeneratedUserId("");
    setReservationId("");
    reservationRef.current = "";
    setGeneratingUserId(true);
    setGenerationError("");

    const timer = window.setTimeout(() => {
      void requestJson<{ ok: true; userId: string; reservationId: string }>(
        "/api/user-ids",
        "POST",
        { kind: "employee", scopeId: companyId, name: cleanName, previousReservationId },
        controller.signal,
      ).then((result) => {
        if (requestVersion.current !== version) return;
        setGeneratedUserId(result.userId);
        setReservationId(result.reservationId);
        reservationRef.current = result.reservationId;
        setGeneratingUserId(false);
      }).catch((error: unknown) => {
        if (requestVersion.current !== version || controller.signal.aborted) return;
        setGeneratedUserId("");
        setReservationId("");
        setGeneratingUserId(false);
        setGenerationError(error instanceof Error ? error.message : "Unable to generate a User ID.");
      });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, createdEmployee, name, companyId, idRefresh, existingEmployee]);

  async function addDepartment() {
    const clean = newDepartment.trim().replace(/\s+/g, " ");
    if (!clean) {
      notify("Enter a department name.", "error");
      return;
    }
    setAddingDepartment(true);
    try {
      const result = await requestJson<{ ok: true; message: string; department: DepartmentOption }>(
        `/api/companies/${companyId}/departments`,
        "POST",
        { name: clean },
      );
      setDepartmentOptions((current) => [...current.filter((item) => item.id !== result.department.id), result.department].sort((a, b) => a.name.localeCompare(b.name)));
      setDepartment(result.department.name);
      setNewDepartment("");
      notify(result.message);
      refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to add department.", "error");
    } finally {
      setAddingDepartment(false);
    }
  }

  function submitEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const error = checkForm(event.currentTarget);
    if (error) {
      notify(error, "error");
      return;
    }
    if (generatingUserId) {
      notify("Wait for the generated User ID.", "error");
      return;
    }
    if (!existingEmployee && (!generatedUserId || !reservationId)) {
      notify(generationError || "Enter a name and wait for the generated User ID.", "error");
      return;
    }
    if (!department) {
      notify("Select or add a department.", "error");
      return;
    }

    const data = new FormData(event.currentTarget);
    const body = {
      name: String(data.get("name") ?? "").trim(),
      reservationId,
      category: String(data.get("category") ?? "EMPLOYEE"),
      department,
    };

    void execute(async () => {
      const result = await requestJson<{ ok: true; message: string; employee: CreatedEmployee }>(
        existingEmployee ? `/api/companies/${companyId}/employees/${existingEmployee.id}` : `/api/companies/${companyId}/employees`,
        existingEmployee ? "PATCH" : "POST",
        existingEmployee ? { name: body.name, department } : body,
      );
      if (existingEmployee) notify(result.message || "Employee details saved.");
      else setCreatedNotice(result.employee);
      if (canManageVehicles) {
        setCreatedEmployee(result.employee);
        setVehicleCard(null);
      } else {
        close();
      }
    });
  }

  function submitVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createdEmployee || pending) return;
    const error = checkForm(event.currentTarget);
    if (error) {
      notify(error, "error");
      return;
    }
    if (registration && !vehicleCard) { notify("Scan a card using a registration reader first.", "error"); return; }
    const data = new FormData(event.currentTarget);
    const body = {
      ownerName: createdEmployee.name,
      plateNumber: String(data.get("plateNumber") ?? "").trim(),
      vehicleType: String(data.get("vehicleType") ?? ""),
      department: createdEmployee.department,
      workerType: String(data.get("workerType") ?? ""),
      enrollmentId: canRegisterRfid ? vehicleCard?.enrollmentId : undefined,
    };

    void execute(async () => {
      const result = await requestJson(
        registration?.vehicle ? "/api/rfid/cards" : `/api/companies/${companyId}/employees/${createdEmployee.id}/vehicles`,
        "POST",
        registration?.vehicle ? { vehicleId: registration.vehicle.id, enrollmentId: vehicleCard?.enrollmentId } : body,
      );
      notify(result.message || "Vehicle registered successfully.");
      close();
    });
  }

  return <>
    <button type="button" className={registration ? "primary-button" : triggerClassName} disabled={disabled} onClick={show}>
      {registration ? "Register card" : <>{showTriggerIcon ? <span className="plus-icon" aria-hidden="true">+</span> : null}{triggerLabel}</>}
    </button>

    {open ? <div className="modal-backdrop" onKeyDown={event => { if (event.key === "Escape" && !pending) close(); }} onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) close(); }}>
      <section className="modal-card employee-create-modal" role="dialog" aria-modal="true" aria-labelledby={modalId + "-title"}>
        <div className="employee-modal-head">
          <div>
            {createdEmployee ? <div className="section-kicker">VEHICLE REGISTRATION</div> : null}
            <h2 id={modalId + "-title"}>{createdEmployee ? (registration?.vehicle ? `Register card for ${createdEmployee.name}` : `Add vehicle for ${createdEmployee.name}`) : "Add Employee / Company Owner"}</h2>
            {registration ? <p>{createdEmployee ? "Scan the card and save to complete registration for this person." : "Review this person and select or add a department, then continue to card registration."}</p> : null}
          </div>
          <button type="button" className="modal-close" aria-label="Close form" disabled={pending} onClick={close}>×</button>
        </div>

        {!createdEmployee ? <form className="employee-create-form" noValidate onSubmit={submitEmployee}>
          <fieldset disabled={pending} className="employee-details-card">
            <div className="employee-card-title"><span>01</span><div><strong>Person details</strong>{existingEmployee ? <small>Existing User ID and parking allocation are retained</small> : null}</div></div>
            <div className="employee-fields-grid">
              <label>Full Name<input name="name" autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Alex Smith" /></label>
              <div className="employee-generated-field">
                <label htmlFor={modalId + "-user-id"}>User ID</label>
                <div className="employee-generated-wrap" style={existingEmployee ? { gridTemplateColumns: "minmax(0,1fr)" } : undefined}>
                  <input id={modalId + "-user-id"} readOnly value={generatedUserId || (generatingUserId ? "Generating..." : "Generated automatically")} aria-invalid={Boolean(generationError)} />
                  {!existingEmployee && <button type="button" aria-label="Refresh User ID" title="Refresh User ID" disabled={pending || generatingUserId || !name.trim()} onClick={() => setIdRefresh((value) => value + 1)}>↻</button>}
                </div>
                {generationError ? <small className="employee-id-error">{generationError}</small> : null}
              </div>
              <label>Person Type<select name="category" defaultValue={existingEmployee?.category || "EMPLOYEE"} disabled={Boolean(existingEmployee)} required><option value="EMPLOYEE">Employee</option><option value="OWNER">Company Owner</option></select></label>
            </div>
          </fieldset>

          <fieldset disabled={pending} className="employee-department-card">
            <div className="employee-card-title"><span>02</span><div><strong>Department</strong></div></div>
            <DepartmentPicker
              companyId={companyId}
              departments={departmentOptions}
              value={department}
              onChange={setDepartment}
              disabled={pending}
              onBusyChange={setDepartmentBusy}
              onRemoved={(id) => setDepartmentOptions((current) => current.filter((item) => item.id !== id))}
            />
            <div className="employee-add-department">
              <div className="employee-department-label"><strong>Add department</strong><span>{departmentOptions.length} department{departmentOptions.length === 1 ? "" : "s"}</span></div>
              <div className="employee-add-department-row">
                <input value={newDepartment} onChange={(event) => setNewDepartment(event.target.value)} placeholder="e.g. Marketing" />
                <button type="button" disabled={addingDepartment || !newDepartment.trim()} onClick={() => void addDepartment()}>{addingDepartment ? "Adding…" : "+ Add"}</button>
              </div>
            </div>
          </fieldset>

          <div className="employee-modal-actions">
            <button type="button" className="secondary-button" disabled={pending} onClick={close}>Cancel</button>
            <ActionButton type="submit" className="primary-button" pending={pending} pendingText={existingEmployee ? "Saving..." : "Adding employee..."}>{existingEmployee ? "Save & Continue" : canManageVehicles ? "Add & Continue" : "Add Employee"}</ActionButton>
          </div>
        </form> : <form className="employee-vehicle-step" noValidate onSubmit={submitVehicle}>
          <fieldset disabled={pending} className="employee-vehicle-grid">
            <label>Owner Name<input value={createdEmployee.name} readOnly /></label>
            {registration?.vehicle ? <label>Plate Number<input value={registration.vehicle.plateNumber} readOnly /></label> : <>
            <label>Plate Number<input name="plateNumber" required autoFocus placeholder="e.g. KA 01 AB 1234" /></label>
            <label>Vehicle Type<select name="vehicleType" defaultValue="" required><option value="" disabled>Select vehicle type</option>{vehicleTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
            <label>Department<input value={createdEmployee.department} readOnly /></label>
            <label>Staff or Employee<select name="workerType" defaultValue={createdEmployee.category === "EMPLOYEE" ? "Employee" : "Staff"} required><option>Staff</option><option>Employee</option></select></label>
            </>}
            {registration?.vehicle?.isInside && <p className="employee-rfid-note">Record the vehicle’s exit before registering its card.</p>}
            {canRegisterRfid ? <div className="employee-card-capture"><CardCapture buildingId={registration?.buildingId} employeeId={createdEmployee.id} vehicleId={registration?.vehicle?.id} onCaptured={setVehicleCard} /></div> : <p className="muted employee-rfid-note">RFID registration is not assigned to this account. The vehicle can still be saved without an RFID card.</p>}
          </fieldset>
          <div className="employee-modal-actions">
            <button type="button" className="secondary-button" disabled={pending} onClick={close}>{registration ? "Cancel" : "Finish without vehicle"}</button>
            <ActionButton type="submit" className="primary-button" pending={pending} pendingText="Registering..." disabled={Boolean(registration && (!vehicleCard || registration.vehicle?.isInside))}>{registration ? "Save registration" : "Register vehicle"}</ActionButton>
          </div>
        </form>}
      </section>
    </div> : null}

    {createdNotice ? <div className="employee-created-toast" role="status" aria-live="polite" aria-atomic="true">
      <span className="employee-toast-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6" /></svg></span>
      <div><strong>Employee created</strong><span>{createdNotice.name} <span aria-hidden="true">/</span> {createdNotice.userId}</span></div>
      <button type="button" aria-label="Dismiss employee notification" onClick={() => setCreatedNotice(null)}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
    </div> : null}

    <style>{`
      .employee-create-modal{width:min(920px,calc(100vw - 30px));max-height:calc(100dvh - 30px);padding:0;overflow:hidden;border-radius:13px;display:flex;flex-direction:column}
      .employee-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:14px 18px 12px;border-bottom:1px solid #e0e7e3;background:#fff}
      .employee-modal-head h2{margin:3px 0 0;font-size:20px;color:#15271e}
      .employee-modal-head p{margin:4px 0 0;max-width:650px;color:#6d7972;font-size:11px;line-height:1.4}
      .employee-create-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(310px,.85fr);grid-template-rows:minmax(0,1fr) auto;min-height:0;overflow:hidden}
      .employee-details-card,.employee-department-card{border:0;margin:0;padding:16px 18px 18px;min-width:0;overflow:auto;background:#fff}
      .employee-details-card{border-right:1px solid #e1e8e4}
      .employee-department-card{background:#f8faf9}
      .employee-card-title{display:flex;align-items:center;gap:9px;margin-bottom:13px}
      .employee-card-title>span{display:grid;place-items:center;min-width:26px;height:22px;border-radius:6px;background:#f1eaf7;color:#7845a5;font-size:9px;font-weight:900}
      .employee-card-title>div{display:grid;gap:1px}
      .employee-card-title strong{font-size:12px;color:#203329}
      .employee-card-title small{font-size:9px;color:#7b8780;font-weight:600}
      .employee-fields-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px 10px}
      .employee-fields-grid label,.employee-generated-field>label{display:grid;gap:5px;color:#304139;font-size:10.5px;font-weight:800}
      .employee-fields-grid input,.employee-fields-grid select,.employee-generated-field input,.employee-add-department input,.employee-vehicle-grid input,.employee-vehicle-grid select{width:100%;min-height:38px;padding:8px 10px;border:1px solid #cbd7d0;border-radius:7px;background:#fff;color:#17261f;font:inherit;outline:none}
      .employee-fields-grid input:focus,.employee-fields-grid select:focus,.employee-add-department input:focus,.employee-vehicle-grid input:focus,.employee-vehicle-grid select:focus{border-color:#804ab0;box-shadow:0 0 0 3px rgba(128,74,176,.10)}
      .employee-generated-wrap{display:grid;grid-template-columns:minmax(0,1fr) 38px;border:1px solid #d7cce1;border-radius:7px;overflow:hidden;background:#f6f1fa}
      .employee-generated-wrap input{border:0!important;border-radius:0!important;background:#f6f1fa!important;color:#70587f;font-weight:800;box-shadow:none!important}
      .employee-generated-wrap button{border:0;border-left:1px solid #ded4e7;background:#f6f1fa;color:#74449f;font-size:19px;font-weight:800;cursor:pointer}
      .employee-generated-wrap button:disabled{opacity:.45;cursor:not-allowed}
      .employee-id-error{display:block;margin-top:4px;color:#bd3434;font-size:9px}
      .employee-add-department{display:grid;gap:6px;margin-top:13px;padding-top:12px;border-top:1px solid #dfe6e2}
      .employee-department-label{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#304139;font-size:10.5px}
      .employee-department-label span{padding:3px 7px;border-radius:999px;background:#eee8f4;color:#72449a;font-size:9px;font-weight:800}
      .employee-add-department-row{display:grid;grid-template-columns:minmax(0,1fr) 72px;gap:7px}
      .employee-add-department-row button{border:1px solid #cbb9dc;border-radius:7px;background:#f2eaf8;color:#704099;font-size:10px;font-weight:900;cursor:pointer}
      .employee-add-department-row button:disabled{opacity:.5;cursor:not-allowed}
      .employee-scope-note{display:grid;gap:3px;margin-top:13px;padding:10px;border:1px solid #d8e3dd;border-radius:8px;background:#eef5f1}
      .employee-scope-note strong{font-size:9px;text-transform:uppercase;letter-spacing:.35px;color:#4f6358}
      .employee-scope-note span{font-size:9px;line-height:1.4;color:#66776d}
      .employee-modal-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:9px;padding:11px 18px;border-top:1px solid #dfe6e2;background:#fff}
      .employee-modal-actions button{min-width:112px}
      .employee-vehicle-step{min-height:0;overflow-y:auto;overflow-x:hidden}
      .employee-vehicle-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px;border:0;padding:14px 18px;margin:0}
      .employee-vehicle-grid label{display:grid;gap:5px;color:#304139;font-size:10.5px;font-weight:800}
      .employee-vehicle-grid input[readonly]{background:#f5f7f6;color:#5f6d65}
      .employee-card-capture,.employee-rfid-note{grid-column:1/-1}
      .employee-vehicle-grid input,.employee-vehicle-grid select{min-height:34px;padding:6px 9px;font-size:12px}
      .employee-card-capture .card-capture{padding:10px;gap:7px;border-width:1px;background:#f7faff}
      .employee-card-capture .card-capture p{font-size:12px;line-height:1.4}
      .employee-modal-head{flex-shrink:0}.employee-modal-actions{flex-shrink:0}
      .employee-created-toast{position:fixed;top:22px;right:22px;z-index:20000;display:flex;align-items:center;gap:12px;width:min(340px,calc(100vw - 32px));padding:14px 36px 14px 14px;border:1px solid #bde4d1;border-radius:12px;background:#fff;box-shadow:0 12px 36px rgba(19,56,40,.18);animation:employee-toast-in .18s ease-out}
      .employee-toast-icon{display:grid;place-items:center;flex-shrink:0;width:36px;height:36px;border-radius:50%;background:#e6f7ed;color:#16824c}
      .employee-created-toast>div{display:grid;gap:3px;min-width:0}.employee-created-toast strong{font-size:14px;color:#163c2b}.employee-created-toast>div>span{font-size:12px;color:#64756c;overflow-wrap:anywhere}
      .employee-created-toast button{position:absolute;right:9px;top:9px;display:grid;place-items:center;padding:4px;border:0;border-radius:5px;background:transparent;color:#718278;cursor:pointer}
      .employee-created-toast button:hover{background:#eef6f1}
      @keyframes employee-toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
      @media(prefers-reduced-motion:reduce){.employee-created-toast{animation:none}}
      @media(max-width:760px){.employee-create-modal{width:min(620px,calc(100vw - 20px));max-height:calc(100vh - 20px);overflow:auto}.employee-create-form{grid-template-columns:1fr;overflow:visible}.employee-details-card{border-right:0;border-bottom:1px solid #e1e8e4}.employee-modal-actions{grid-column:auto;position:sticky;bottom:0}.employee-fields-grid,.employee-vehicle-grid{grid-template-columns:1fr}.employee-card-capture,.employee-rfid-note{grid-column:auto}}
    `}</style>
  </>;
}
