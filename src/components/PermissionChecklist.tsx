"use client";

import { useId, useState } from "react";
import type { UserRole } from "@prisma/client";
import { permissionOptionsForRole, type PermissionKey } from "@/lib/permissions";

function rolePermissionLabel(role: UserRole) {
  if (role === "BUILDING_ADMIN") return "Admin / Building Admin";
  if (role === "COMPANY_ADMIN" || role === "BUILDING_OWNER") return "Company / User";
  if (role === "EMPLOYEE") return "Supervisor";
  return "Permissions";
}

const ROLE_GROUPS: UserRole[] = ["BUILDING_ADMIN", "COMPANY_ADMIN", "EMPLOYEE"];

function RolePermissionGroup({ groupRole, editable, value, onChange, disabled }: {
  groupRole: UserRole;
  editable: boolean;
  value: PermissionKey[];
  onChange: (value: PermissionKey[]) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(editable);
  const listId = useId();
  const options = permissionOptionsForRole(groupRole);
  const selected = options.filter(option => value.includes(option.key)).length;
  const label = rolePermissionLabel(groupRole);

  function selectGroup(checked: boolean) {
    if (!editable || disabled) return;
    const keys = new Set(options.map(option => option.key));
    onChange(checked ? Array.from(new Set([...value, ...keys])) : value.filter(key => !keys.has(key)));
  }

  return <div className={`permission-role-group${editable ? " is-editable" : " is-reference"}`}>
    <div className="permission-tree-root">
      <button type="button" className="permission-tree-branch" aria-expanded={expanded} aria-controls={listId}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`} onClick={() => setExpanded(open => !open)}>
        {expanded ? "?" : "+"}
      </button>
      <input type="checkbox" checked={editable && selected === options.length} disabled={disabled || !editable}
        aria-label={`Select all ${label}`} onChange={event => selectGroup(event.target.checked)} />
      <strong>{label}</strong>
      <span className="permission-role-note">{editable ? `${selected}/${options.length}` : "View only"}</span>
    </div>
    <div id={listId} className="permission-tree-items" hidden={!expanded}>
      {options.map(option => <label className="permission-tree-item" key={option.key} title={option.description}>
        <span className="permission-tree-line" aria-hidden="true" />
        <input type="checkbox" checked={editable && value.includes(option.key)} disabled={disabled || !editable}
          onChange={event => {
            if (!editable || disabled) return;
            onChange(event.target.checked ? Array.from(new Set([...value, option.key])) : value.filter(key => key !== option.key));
          }} />
        <span className="permission-tree-text"><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}
    </div>
  </div>;
}

export default function PermissionChecklist({
  role,
  value,
  onChange,
  disabled = false,
  title,
}: {
  role: UserRole;
  value: PermissionKey[];
  onChange: (value: PermissionKey[]) => void;
  disabled?: boolean;
  title?: string;
}) {
  const options = permissionOptionsForRole(role);
  const selected = options.filter(option => value.includes(option.key)).length;
  const allSelected = options.length > 0 && selected === options.length;
  const assignedRole = role === "BUILDING_OWNER" ? "COMPANY_ADMIN" : role;

  function selectAll() {
    if (disabled) return;
    onChange(options.map((option) => option.key));
  }

  function deselectAll() {
    if (disabled) return;
    onChange([]);
  }

  return <section className="permission-panel" aria-label={`${title || "Feature access"} permissions`}>
    <div className="permission-title-row">
      <label>{title || "Permissions Allowed"}</label>
      <span>{selected}/{options.length}</span>
    </div>

    <div className="permission-tree" role="group" aria-label="Role responsibilities">
      {ROLE_GROUPS.map(groupRole => <RolePermissionGroup key={`${role}-${groupRole}`} groupRole={groupRole}
        editable={groupRole === assignedRole} value={value} onChange={onChange} disabled={disabled} />)}
    </div>

    <div className="permission-actions" aria-label="Permission selection controls">
      <button type="button" disabled={disabled || allSelected} onClick={selectAll}>Select All</button>
      <button type="button" disabled={disabled || value.length === 0} onClick={deselectAll}>Deselect All</button>
    </div>

    <p className="permission-scope-note">Edit the assigned role only. Other roles are shown for reference. Access remains restricted to the assigned building or company.</p>

    <style>{`
      .permission-panel{min-width:0;display:flex;flex-direction:column;gap:6px}
      .permission-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#2d3c34;font-size:11px;font-weight:800}
      .permission-title-row>span{min-width:34px;padding:3px 7px;border:1px solid #d8e0dc;border-radius:4px;background:#f4f7f5;color:#6b4a83;text-align:center;font-size:9px}
      .permission-tree{height:300px;overflow:auto;border:1px solid #aebbb4;background:#fff;padding:5px 4px;font-size:11px;box-shadow:inset 0 1px 2px rgba(22,36,28,.05)}
      .permission-tree-root{display:grid;grid-template-columns:22px 15px minmax(0,1fr) auto;align-items:center;gap:4px;min-height:22px;padding:1px 3px;color:#1f3027}
      .permission-tree-root strong{font-size:11px}
      .permission-tree-branch{width:22px!important;height:22px!important;min-height:22px!important;padding:0!important;display:grid;place-items:center;border:1px solid #aab8b0;border-radius:3px;background:#fff;color:#516058;font-size:15px;line-height:1;cursor:pointer}
      .permission-tree-branch:focus-visible{outline:2px solid #675084;outline-offset:2px}
      .permission-role-group{padding:4px 0;border-bottom:1px solid #e1e7e3}
      .permission-role-group:last-child{border-bottom:0}
      .permission-role-group.is-editable>.permission-tree-root{background:#f4f0fa}
      .permission-role-note{font-size:9px;color:#748078;padding-right:3px}
      .permission-tree-items[hidden]{display:none}
      .permission-tree input{width:13px!important;height:13px;margin:0;padding:0!important;accent-color:#675084;box-shadow:none!important}
      .permission-tree-items{position:relative;margin-left:12px;padding-left:12px}
      .permission-tree-items:before{content:"";position:absolute;left:4px;top:0;bottom:10px;border-left:1px dotted #9aa69f}
      .permission-tree-item{position:relative;display:grid!important;grid-template-columns:8px 15px minmax(0,1fr);align-items:start;gap:4px!important;min-height:24px;padding:3px 3px 3px 0!important;color:#26362d;cursor:pointer}
      .permission-tree-line{height:10px;margin-top:1px;border-bottom:1px dotted #9aa69f}
      .permission-tree-text{display:block;min-width:0;line-height:1.2}
      .permission-tree-text strong{display:block;font-size:10.5px;font-weight:600;color:#24342b}
      .permission-tree-text small{display:none;margin-top:2px;color:#748078;font-size:8px;font-weight:500}
      .permission-tree-item:hover .permission-tree-text small{display:block}
      .permission-tree-item:hover{background:#f5f7fb}
      .permission-actions{display:flex;gap:18px;padding:2px 1px 0}
      .permission-actions button{border:0;background:transparent;padding:0;color:#4f43b5;text-decoration:underline;font-size:9.5px;font-weight:600;cursor:pointer}
      .permission-actions button:disabled{color:#9da7a1;text-decoration:none;cursor:default;opacity:1}
      .permission-scope-note{margin:3px 0 0;color:#6e7973;font-size:9px;line-height:1.4}
      @media(max-width:720px){.permission-tree{height:240px}}
    `}</style>
  </section>;
}
