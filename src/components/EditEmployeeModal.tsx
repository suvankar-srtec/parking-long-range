"use client";

import { useEffect, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/client-request";
import { useFeedback, useMutation } from "./FeedbackProvider";
import { ActionButton } from "./LoadingIndicator";

type DepartmentOption = { id: string; name: string };
type EmployeeSummary = {
  id: string;
  name: string;
  userId: string;
  category: string;
  parkingLimit: number;
  department: string;
  isPlaceholder?: boolean;
  slotNumber?: number | null;
};

export default function EditEmployeeModal({ companyId, employee, departments }: { companyId: string; employee: EmployeeSummary; departments: DepartmentOption[] }) {
  const { notify, refresh } = useFeedback();
  const { pending, execute } = useMutation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(employee.name);
  const [department, setDepartment] = useState(employee.department === "Unassigned" ? "" : employee.department);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  function show() {
    setName(employee.isPlaceholder ? "" : employee.name);
    setDepartment(employee.department === "Unassigned" ? "" : employee.department);
    setOpen(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const cleanName = name.trim();
    if (!cleanName) {
      notify("Enter the employee name.", "error");
      return;
    }
    if (!department) {
      notify("Select a department.", "error");
      return;
    }

    void execute(async () => {
      const result = await requestJson<{ ok: true; message: string }>(
        `/api/companies/${companyId}/employees/${employee.id}`,
        "PATCH",
        { name: cleanName, department },
      );
      setOpen(false);
      notify(result.message || "Employee updated successfully.");
      refresh();
    });
  }

  return <>
    <button type="button" className="secondary-button employee-edit-button" onClick={show}>Edit</button>
    {open && <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) setOpen(false);
    }} onKeyDown={(event) => { if (event.key === "Escape" && !pending) setOpen(false); }}>
      <section className="modal-card employee-edit-modal" role="dialog" aria-modal="true" aria-labelledby={`edit-employee-${employee.id}`}>
        <div className="employee-edit-head">
          <div>
            <h2 id={`edit-employee-${employee.id}`}>Edit employee</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close form" disabled={pending} onClick={() => setOpen(false)}>×</button>
        </div>
        <form className="employee-edit-form" aria-busy={pending} onSubmit={submit}>
          <fieldset className="employee-edit-fields" disabled={pending}>
            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required autoFocus placeholder="Employee name" /></label>
            <label>User ID<input value={employee.userId} readOnly /></label>
            <label className="employee-edit-department">Department<select name="department" value={department} onChange={event => setDepartment(event.target.value)} required>
              <option value="" disabled>Select department</option>
              {departments.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select></label>
          </fieldset>
          <div className="employee-edit-actions">
            <button type="button" className="secondary-button" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
            <ActionButton type="submit" className="primary-button" pending={pending} pendingText="Updating…">Save changes</ActionButton>
          </div>
        </form>
      </section>
    </div>}
    <style jsx>{`
      .employee-edit-modal{width:min(580px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:0;overflow:auto;border-radius:12px}
      .employee-edit-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;border-bottom:1px solid #dce6f0}
      .employee-edit-head h2{font-size:20px;margin:0;color:#182d43}
      .employee-edit-form{display:grid;gap:0}
      .employee-edit-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;border:0;padding:18px;margin:0;min-width:0}
      .employee-edit-fields label{display:grid;gap:6px;font-size:12px;font-weight:700;color:#33495e;min-width:0}
      .employee-edit-fields input,.employee-edit-fields select{width:100%;min-height:36px;padding:7px 10px;border:1px solid #a9bfd5;border-radius:6px;background:#fff;color:#1e3349;font:inherit}
      .employee-edit-fields input[readonly]{background:#f3f6fa;color:#667a8f}
      .employee-edit-fields input:focus,.employee-edit-fields select:focus{outline:2px solid #70a5de;outline-offset:1px}
      .employee-edit-department{grid-column:1/-1}
      .employee-edit-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #dce6f0;background:#f8fbff}
      @media(max-width:480px){.employee-edit-fields{grid-template-columns:1fr;gap:12px}.employee-edit-head{padding:14px}.employee-edit-fields{padding:14px}.employee-edit-actions{padding:12px 14px}}
    `}</style>
  </>;
}
