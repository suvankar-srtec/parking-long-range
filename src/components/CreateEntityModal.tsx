"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { UserRole } from "@prisma/client";
import { checkForm, requestJson } from "@/lib/client-request";
import { parkingFields, validateParking } from "@/lib/parking";
import { defaultPermissionsForRole, type PermissionKey } from "@/lib/permissions";
import { useFeedback, useMutation } from "./FeedbackProvider";
import { ActionButton } from "./LoadingIndicator";
import DepartmentPicker from "./DepartmentPicker";
import ParkingInputs from "./ParkingInputs";
import PasswordInput from "./PasswordInput";
import PermissionChecklist from "./PermissionChecklist";
import CardCapture, { type CapturedCard } from "./CardCapture";

type DepartmentOption = { id: string; name: string };
type CreatedEmployee = { id: string; name: string; userId: string; category: string; parkingLimit: number; department: string };
const emptyDepartments: DepartmentOption[] = [];
const vehicleTypes = ["Two wheeler", "Four wheeler"];

export default function CreateEntityModal({
  kind,
  buildingId,
  companyId,
  departments = emptyDepartments,
  maximumDepartments = 10,
  canManageVehicles = true,
  canRegisterRfid = true,
}: {
  kind: "building" | "company" | "employee";
  buildingId?: string;
  companyId?: string;
  departments?: DepartmentOption[];
  maximumDepartments?: number;
  canManageVehicles?: boolean;
  canRegisterRfid?: boolean;
}) {
  const { notify, refresh } = useFeedback();
  const { pending: saving, execute } = useMutation();
  const [departmentBusy, setDepartmentBusy] = useState(false);
  const pending = saving || departmentBusy;
  const [open, setOpen] = useState(false);
  const [parking, setParking] = useState(() => parkingFields({ totalParking: 100, ownerParking: 15, visitorParking: 0, companyParking: 85 }));
  const isBuilding = kind === "building";
  const creationRole: UserRole | null = isBuilding ? "BUILDING_ADMIN" : kind === "company" ? "COMPANY_ADMIN" : null;
  const title = isBuilding ? "Create building" : kind === "company" ? "Create company" : "Add Employee";
  const [permissions, setPermissions] = useState<PermissionKey[]>(() => creationRole ? defaultPermissionsForRole(creationRole) : []);
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
  const [departmentLimit, setDepartmentLimit] = useState(1);
  const [createdEmployee, setCreatedEmployee] = useState<CreatedEmployee | null>(null);
  const [vehicleCard, setVehicleCard] = useState<CapturedCard | null>(null);
  const requestVersion = useRef(0);
  const reservationRef = useRef("");

  useEffect(() => { setDepartmentOptions(departments); }, [departments]);

  function show() {
    setParking(parkingFields({ totalParking: 100, ownerParking: 15, visitorParking: 0, companyParking: 85 }));
    setName("");
    setGeneratedUserId("");
    setReservationId("");
    reservationRef.current = "";
    setGeneratingUserId(false);
    setGenerationError("");
    setDepartmentOptions(departments);
    setDepartment(departments[0]?.name || "");
    setNewDepartment("");
    setDepartmentLimit(1);
    setPermissions(creationRole ? defaultPermissionsForRole(creationRole) : []);
    setCreatedEmployee(null);
    setVehicleCard(null);
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setCreatedEmployee(null);
    setVehicleCard(null);
    refresh();
  }

  async function addDepartment() {
    const clean = newDepartment.trim().replace(/\s+/g, " ");
    if (!companyId || !clean) { notify("Enter a department name.", "error"); return; }
    if (departmentOptions.length >= maximumDepartments) { notify(`This company can have a maximum of ${maximumDepartments} departments.`, "error"); return; }
    setAddingDepartment(true);
    try {
      const result = await requestJson<{ ok: true; message: string; department: DepartmentOption }>(`/api/companies/${companyId}/departments`, "POST", { name: clean });
      setDepartmentOptions((current) => [...current.filter((item) => item.id !== result.department.id), result.department].sort((a, b) => a.name.localeCompare(b.name)));
      setDepartment(result.department.name);
      setNewDepartment("");
      notify(result.message);
      refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to add department.", "error");
    } finally { setAddingDepartment(false); }
  }

  useEffect(() => {
    const version = ++requestVersion.current;
    const trimmedName = name.trim();
    if (!open || createdEmployee || !trimmedName) {
      if (!createdEmployee) {
        setGeneratedUserId(""); setReservationId(""); reservationRef.current = ""; setGeneratingUserId(false); setGenerationError("");
      }
      return;
    }
    const controller = new AbortController();
    const scopeId = isBuilding ? "" : kind === "company" ? buildingId : companyId;
    const previousReservationId = reservationRef.current;
    setGeneratedUserId(""); setReservationId(""); reservationRef.current = ""; setGeneratingUserId(true); setGenerationError("");
    const timer = window.setTimeout(() => {
      void requestJson<{ ok: true; userId: string; reservationId: string }>("/api/user-ids", "POST", { kind, scopeId, name: trimmedName, previousReservationId }, controller.signal)
        .then((result) => {
          if (requestVersion.current !== version) return;
          setGeneratedUserId(result.userId); setReservationId(result.reservationId); reservationRef.current = result.reservationId; setGeneratingUserId(false);
        })
        .catch((error: unknown) => {
          if (requestVersion.current !== version || controller.signal.aborted) return;
          setGeneratedUserId(""); setReservationId(""); setGeneratingUserId(false); setGenerationError(error instanceof Error ? error.message : "Unable to generate a User ID.");
        });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, name, kind, buildingId, companyId, isBuilding, idRefresh, createdEmployee]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || addingDepartment) return;
    const formError = checkForm(event.currentTarget);
    if (formError) { notify(formError, "error"); return; }
    const formData = new FormData(event.currentTarget);
    const entityName = String(formData.get("name") ?? "").trim();
    const credentials = isBuilding || kind === "company" ? { name: entityName, password: String(formData.get("password") ?? "") } : { name: entityName };
    if (!credentials.name || ("password" in credentials && !credentials.password?.trim())) {
      notify(isBuilding || kind === "company" ? "Enter a name and password." : "Enter a name.", "error"); return;
    }
    if (generatingUserId) { notify("Wait for the generated User ID.", "error"); return; }
    if (!generatedUserId || !reservationId) { notify(generationError || "Enter a name and wait for the generated User ID.", "error"); return; }

    let body: Record<string, unknown> = { ...credentials, userId: generatedUserId, reservationId };
    if (creationRole) body.permissions = permissions;
    if (isBuilding) {
      delete body.userId;
      const maximumGate = Number(formData.get("maximumGate"));
      if (!Number.isInteger(maximumGate) || maximumGate < 1) { notify("Maximum Gate must be at least 1.", "error"); return; }
      const parsed = validateParking({ totalParking: Number(parking.totalParking), ownerParking: Number(parking.ownerParking), visitorParking: Number(parking.visitorParking), companyParking: Number(parking.companyParking) });
      if (!parsed.ok) { notify(parsed.message, "error"); return; }
      body = { ...body, ...parsed.values, maximumGate };
    } else if (kind === "company") {
      body.parkingAllocation = Number(formData.get("parkingAllocation") ?? 0);
      body.maximumDepartments = departmentLimit;
    } else {
      if (!department) { notify("Select or add a department.", "error"); return; }
      body.category = String(formData.get("category") ?? "EMPLOYEE");
      body.parkingLimit = Number(formData.get("parkingLimit") ?? 1);
      body.department = department;
    }

    void execute(async () => {
      const endpoint = isBuilding ? "/api/buildings" : kind === "company" ? `/api/buildings/${buildingId}/companies` : `/api/companies/${companyId}/employees`;
      if (kind === "employee") {
        const result = await requestJson<{ ok: true; message: string; employee: CreatedEmployee }>(endpoint, "POST", body);
        notify(result.message || "Employee created successfully.");
        if (canManageVehicles) {
          setCreatedEmployee(result.employee);
          setVehicleCard(null);
        } else {
          closeModal();
        }
        return;
      }
      const result = await requestJson(endpoint, "POST", body);
      setOpen(false);
      notify(result.message || `${title} created successfully.`);
      refresh();
    });
  }

  function submitVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createdEmployee || !companyId || pending) return;
    const formError = checkForm(event.currentTarget);
    if (formError) { notify(formError, "error"); return; }
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
      const result = await requestJson(`/api/companies/${companyId}/employees/${createdEmployee.id}/vehicles`, "POST", body);
      notify(result.message || "Vehicle registered successfully.");
      closeModal();
    });
  }

  const accountFields = <fieldset className="entity-fields compact-entity-fields" disabled={pending}>
    <label>{isBuilding ? "Building name" : "Company name"}<input name="name" autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={isBuilding ? "e.g. Central Plaza" : "e.g. Acme"} /></label>
    <div className="generated-id-field">
      <label htmlFor="generated-user-id">{isBuilding ? "Building User ID" : "User ID"}</label>
      <div className="generated-id-wrap">
        <input id="generated-user-id" readOnly value={generatedUserId || (generatingUserId ? "Generating..." : "Generated automatically")} aria-invalid={Boolean(generationError)} />
        <button type="button" className="id-refresh" aria-label="Refresh User ID" title="Refresh User ID" disabled={pending || generatingUserId || !name.trim()} onClick={() => setIdRefresh((value) => value + 1)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.7 7A7 7 0 0 1 20 12M4 12a7 7 0 0 0 14.3 5" /></svg>
        </button>
      </div>
    </div>
    <PasswordInput label={isBuilding ? "Building password" : "Password"} name="password" required autoComplete="new-password" placeholder="Password" disabled={pending} />
    {isBuilding ? <label>Maximum Gate<input name="maximumGate" type="number" min="1" step="1" defaultValue="1" required /></label> : <>
      <label>Parking allocation<input name="parkingAllocation" type="number" min="0" step="1" max="2147483647" defaultValue="0" required /></label>
      <div className="department-limit-field"><span>Department</span><div className="department-stepper"><button type="button" aria-label="Decrease department limit" onClick={() => setDepartmentLimit((value) => Math.max(1, value - 1))}>−</button><strong>{departmentLimit}</strong><button type="button" aria-label="Increase department limit" onClick={() => setDepartmentLimit((value) => Math.min(500, value + 1))}>+</button></div></div>
    </>}
  </fieldset>;

  const employeeVehicleStep = createdEmployee ? <form className="modal-form entity-form employee-vehicle-form" noValidate onSubmit={submitVehicle}>
    <div className="employee-created-banner">
      <div><span>EMPLOYEE CREATED</span><strong>{createdEmployee.name}</strong><small>{createdEmployee.userId} · {createdEmployee.department} · Parking limit {createdEmployee.parkingLimit}</small></div>
      <span className="success-check">✓</span>
    </div>
    <fieldset className="entity-fields" disabled={pending}>
      <label>Owner Name<input value={createdEmployee.name} readOnly /></label>
      <label>Plate Number<input name="plateNumber" required autoFocus placeholder="e.g. KA 01 AB 1234" /></label>
      <label>Vehicle Type<select name="vehicleType" defaultValue="" required><option value="" disabled>Select vehicle type</option>{vehicleTypes.map((vehicleType) => <option key={vehicleType}>{vehicleType}</option>)}</select></label>
      <label>Department<input value={createdEmployee.department} readOnly /></label>
      <label>Staff or Employee<select name="workerType" defaultValue={createdEmployee.category === "EMPLOYEE" ? "Employee" : "Staff"} required><option>Staff</option><option>Employee</option></select></label>
      {canRegisterRfid ? <div className="integrated-card-capture"><CardCapture employeeId={createdEmployee.id} onCaptured={setVehicleCard} /></div> : <p className="muted integrated-card-note">RFID registration is not assigned to this account. The vehicle can still be saved without an RFID card.</p>}
    </fieldset>
    <div className="modal-actions">
      <button type="button" className="secondary-button" disabled={pending} onClick={closeModal}>Finish without vehicle</button>
      <ActionButton type="submit" className="primary-button" pending={pending} pendingText="Registering…">Register vehicle</ActionButton>
    </div>
  </form> : null;

  return <>
    <button type="button" className={isBuilding ? "create-building-card" : "add-building-button"} onClick={show}>
      <span className={isBuilding ? "create-building-icon" : "plus-icon"} aria-hidden="true">+</span>
      {isBuilding ? "Create building" : kind === "company" ? "New company" : "Add Employee"}
    </button>
    {open && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) closeModal(); }} onKeyDown={(event) => { if (event.key === "Escape" && !pending) closeModal(); }}>
      <section className={creationRole ? `modal-card permission-modal${isBuilding ? " building-permission-modal" : ""}` : "modal-card small-modal"} role="dialog" aria-modal="true" aria-labelledby="entity-modal-title">
        <div className="modal-head permission-modal-head">
          <div>
            <div className="section-kicker" id={isBuilding ? "entity-modal-title" : undefined}>{createdEmployee ? "VEHICLE REGISTRATION" : "ACCOUNT SETUP"}</div>
            {!isBuilding && <><h2 id="entity-modal-title">{createdEmployee ? `Add vehicle for ${createdEmployee.name}` : title}</h2>
            <p>{createdEmployee ? "The employee is saved. Register a vehicle and RFID card now, or finish without a vehicle." : isBuilding ? "Create the building account, define parking capacity, and control exactly which features the Building Admin can use." : kind === "company" ? "Add a company and choose the Company/User features this account can access." : "Create the employee or company owner first, then register their vehicle in the same window."}</p></>}
          </div>
          <button type="button" className="modal-close" aria-label="Close form" disabled={pending} onClick={closeModal}>×</button>
        </div>
        {createdEmployee ? employeeVehicleStep : <form className={`modal-form entity-form${creationRole ? " permission-layout-form" : ""}`} aria-busy={pending} noValidate onSubmit={submit}>
          {creationRole ? <>
            <div className="entity-main-column setup-card">
              <div className="setup-card-head">
                <div><span className="setup-step">01</span><strong>{isBuilding ? "Building & Admin details" : "Company account details"}</strong></div>
                <small>{isBuilding ? "Account User ID is generated automatically" : "Company User ID is generated automatically"}</small>
              </div>
              {accountFields}
              {isBuilding ? <div className="parking-section">
                <div className="subsection-title"><span className="setup-step">02</span><strong>Parking allocation</strong><small>Visitor parking is reserved from the Owner parking share.</small></div>
                <ParkingInputs fields={parking} onChange={setParking} disabled={pending} />
              </div> : null}
            </div>
            <aside className="permission-side-panel">
              <div className="permission-side-head">
                <div><span className="setup-step">{isBuilding ? "03" : "02"}</span><strong>Feature access</strong></div>
                <span className="role-chip">{isBuilding ? "Admin / Building Admin" : "Company / User"}</span>
              </div>
              <p className="permission-side-copy">Uncheck any feature that this user should not be allowed to access.</p>
              <PermissionChecklist role={creationRole} value={permissions} onChange={setPermissions} disabled={pending} title="Permissions Allowed" />
            </aside>
          </> : <fieldset className="entity-fields" disabled={pending}>
            <label>Name<input name="name" autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Alex Smith" /></label>
            <div className="generated-id-field"><label htmlFor="generated-user-id">User ID</label><div className="generated-id-wrap"><input id="generated-user-id" readOnly value={generatedUserId || (generatingUserId ? "Generating..." : "Generated automatically")} aria-invalid={Boolean(generationError)} /><button type="button" className="id-refresh" aria-label="Refresh User ID" title="Refresh User ID" disabled={pending || generatingUserId || !name.trim()} onClick={() => setIdRefresh((value) => value + 1)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.7 7A7 7 0 0 1 20 12M4 12a7 7 0 0 0 14.3 5" /></svg></button></div></div>
            <label>Type<select name="category" defaultValue="EMPLOYEE" required><option value="EMPLOYEE">Employee</option><option value="OWNER">Company Owner</option></select></label>
            <label>Parking lot limit<input name="parkingLimit" type="number" min="1" step="1" defaultValue="1" required /></label>
            <DepartmentPicker companyId={companyId!} departments={departmentOptions} value={department} onChange={setDepartment} disabled={pending || addingDepartment} onBusyChange={setDepartmentBusy} onRemoved={(id) => setDepartmentOptions((current) => current.filter((item) => item.id !== id))} />
            <div className="generated-id-field"><label htmlFor="new-department">Add department <span className="department-count">{departmentOptions.length}/{maximumDepartments}</span></label><div className="generated-id-wrap"><input id="new-department" value={newDepartment} onChange={(event) => setNewDepartment(event.target.value)} placeholder="e.g. Marketing" /><button type="button" className="id-refresh" style={{ width: 68, borderRadius: 7, fontWeight: 800, fontSize: 11 }} disabled={addingDepartment || !newDepartment.trim() || departmentOptions.length >= maximumDepartments} onClick={() => void addDepartment()}>{addingDepartment ? "Adding…" : "+ Add"}</button></div></div>
          </fieldset>}
          <div className="modal-actions permission-modal-actions">
            <button type="button" className="secondary-button" disabled={pending} onClick={closeModal}>Cancel</button>
            <ActionButton type="submit" className="primary-button" pending={pending} pendingText={kind === "employee" ? "Adding employee…" : `Creating ${kind}…`}>{kind === "employee" ? (canManageVehicles ? "Add Employee & Continue" : "Add Employee") : title}</ActionButton>
          </div>
        </form>}
      </section>
    </div>}
    <style>{`
      .permission-modal{width:min(1040px,calc(100vw - 34px));max-height:calc(100vh - 34px);padding:0;overflow:hidden;display:flex;flex-direction:column;border-radius:13px}
      .permission-modal-head{padding:16px 20px 13px;margin:0;flex:0 0 auto;border-bottom:1px solid #e1e8e4;background:#fff}
      .building-permission-modal,.building-permission-modal input,.building-permission-modal button,.building-permission-modal select,.building-permission-modal textarea{font-family:"Segoe UI",Arial,sans-serif!important;font-size:13px;font-weight:400;-webkit-font-smoothing:antialiased}
      .building-permission-modal .section-kicker{font-size:13px;font-weight:700;letter-spacing:.06em}
      .building-permission-modal .setup-card-head strong,.building-permission-modal .permission-side-head strong,.building-permission-modal .subsection-title strong{font-size:14px;font-weight:600}
      .building-permission-modal .compact-entity-fields label{font-size:12px;font-weight:600}
      .building-permission-modal .compact-entity-fields input{font-size:14px!important;font-weight:400!important}
      .building-permission-modal .setup-card-head small,.building-permission-modal .subsection-title small,.building-permission-modal .permission-side-copy,.building-permission-modal .permission-scope-note{font-size:11px;line-height:1.5;font-weight:400}
      .building-permission-modal .permission-title-row{font-size:14px;font-weight:600}
      .building-permission-modal .permission-tree-root strong{font-size:12px;font-weight:600}
      .building-permission-modal .permission-tree-text strong{font-size:12px;font-weight:400;line-height:1.4}
      .building-permission-modal .permission-tree-item{min-height:27px}
      .building-permission-modal .permission-actions button{font-size:11px;font-weight:500}
      .building-permission-modal .permission-modal-actions button{font-size:14px;font-weight:600}
      .permission-modal-head h2{margin-top:2px;font-size:20px}
      .permission-modal-head p{max-width:760px;margin-top:4px;font-size:11px;line-height:1.4}
      .permission-layout-form{display:grid!important;grid-template-columns:minmax(0,1.12fr) minmax(365px,.88fr);grid-template-rows:minmax(0,1fr) auto;align-items:stretch;gap:0!important;margin:0!important;min-height:0;overflow:hidden}
      .entity-main-column{display:flex;flex-direction:column;gap:13px;min-width:0;padding:15px 17px 17px;overflow:auto;background:#fff}
      .setup-card{border-right:1px solid #e1e8e4}
      .setup-card-head,.permission-side-head,.subsection-title{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .setup-card-head>div,.permission-side-head>div,.subsection-title{min-width:0}
      .setup-card-head>div,.permission-side-head>div{display:flex;align-items:center;gap:8px}
      .setup-card-head strong,.permission-side-head strong,.subsection-title strong{color:#1d3026;font-size:12px}
      .setup-card-head small,.subsection-title small{color:#7a8780;font-size:9px;font-weight:600}
      .setup-step{display:inline-grid;place-items:center;min-width:25px;height:21px;padding:0 6px;border-radius:6px;background:#f2ebf8;color:#7444a1;font-size:9px;font-weight:900;letter-spacing:.3px}
      .compact-entity-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 10px;border:0;padding:0;margin:0}
      .compact-entity-fields label{font-size:10.5px;gap:4px}
      .compact-entity-fields input,.compact-entity-fields select{padding:7px 9px;min-height:35px;border-radius:7px}
      .compact-entity-fields .generated-id-wrap input{background:#f7f4fa}
      .parking-section{display:grid;gap:8px;padding-top:3px}
      .subsection-title{justify-content:flex-start;border-top:1px solid #e6ece8;padding-top:11px}
      .subsection-title small{margin-left:auto;text-align:right}
      .permission-layout-form .parking-editor-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:7px!important}
      .permission-layout-form .parking-input-card{padding:8px!important;border-radius:8px!important}
      .permission-layout-form .parking-input-card input{min-height:36px!important;padding:6px 8px!important;font-size:19px!important}
      .permission-side-panel{min-width:0;padding:15px 17px 14px;overflow:hidden;background:#f9fbfa}
      .role-chip{display:inline-flex;align-items:center;min-height:24px;padding:4px 8px;border:1px solid #ded2e9;border-radius:999px;background:#f6f1fa;color:#704099;font-size:9px;font-weight:800;white-space:nowrap}
      .permission-side-copy{margin:7px 0 9px;color:#728078;font-size:9.5px;line-height:1.4}
      .permission-side-panel .permission-panel{gap:5px}
      .permission-side-panel .permission-title-row{padding:0 1px}
      .permission-side-panel .permission-tree{height:252px;border-radius:7px;border-color:#cfd9d3}
      .permission-side-panel .permission-scope-note{padding:7px 8px;margin-top:2px;border-radius:6px;background:#eef5f1;color:#52645a}
      .permission-modal-actions{grid-column:1/-1!important;display:flex!important;justify-content:flex-end!important;gap:9px!important;margin:0!important;padding:11px 17px!important;border-top:1px solid #dfe7e2;background:#fff;position:relative;z-index:2}
      .permission-modal-actions button{min-width:105px}
      .department-limit-field{display:flex;flex-direction:column;gap:7px;font-size:12px;font-weight:700;color:#304238}.department-stepper{height:42px;border:1px solid #cad6cf;border-radius:8px;background:#fff;display:grid;grid-template-columns:44px 1fr 44px;align-items:center;overflow:hidden}.department-stepper button{height:100%;border:0;background:#f6f8f7;color:#6f3da3;font-size:20px;font-weight:900;cursor:pointer}.department-stepper button:hover{background:#efe6f6}.department-stepper strong{text-align:center;font-size:15px;color:#2a3a31}.department-count{font-size:10px;color:#7d8982;font-weight:700}
      .employee-vehicle-form{margin-top:12px}.employee-created-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px;border:1px solid #cfe6d9;border-radius:9px;background:#f2faf5}.employee-created-banner>div{display:grid;gap:2px}.employee-created-banner span:first-child{font-size:9px;font-weight:900;color:#31865a;letter-spacing:.5px}.employee-created-banner strong{font-size:14px;color:#20362a}.employee-created-banner small{font-size:10px;color:#6d7b73}.success-check{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:#dff3e7;color:#1c8b51;font-size:16px;font-weight:900}.employee-vehicle-form .entity-fields{margin-top:0}.employee-vehicle-form input[readonly]{background:#f6f8f7;color:#58655e}.integrated-card-capture{grid-column:1/-1}.integrated-card-note{grid-column:1/-1}
      @media(max-height:700px) and (min-width:821px){.permission-modal-head{padding-top:12px;padding-bottom:10px}.permission-modal-head p{margin-top:2px}.entity-main-column,.permission-side-panel{padding-top:11px;padding-bottom:11px}.permission-side-panel .permission-tree{height:220px}.permission-layout-form .parking-input-card{padding:6px!important}.permission-modal-actions{padding-top:9px!important;padding-bottom:9px!important}}
      @media(max-width:820px){.permission-modal{width:min(720px,calc(100vw - 22px));max-height:calc(100vh - 22px);overflow:auto}.permission-layout-form{grid-template-columns:1fr;overflow:visible}.setup-card{border-right:0;border-bottom:1px solid #e1e8e4}.entity-main-column,.permission-side-panel{overflow:visible}.permission-modal-actions{grid-column:auto!important;position:sticky;bottom:0}.compact-entity-fields{grid-template-columns:1fr 1fr}}
      @media(max-width:560px){.permission-modal-head{padding:14px}.entity-main-column,.permission-side-panel{padding:13px}.compact-entity-fields{grid-template-columns:1fr}.permission-layout-form .parking-editor-grid{grid-template-columns:1fr!important}.setup-card-head,.subsection-title{align-items:flex-start;flex-direction:column}.subsection-title small{margin-left:0;text-align:left}.integrated-card-capture,.integrated-card-note{grid-column:auto}}
    `}</style>
  </>;
}
