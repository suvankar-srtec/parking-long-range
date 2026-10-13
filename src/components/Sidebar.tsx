"use client";

import type { UserRole } from "@prisma/client";
import Link from "@/components/AppLink";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import NotificationBadge from "./NotificationBadge";
import SidebarReaderStatus from "./SidebarReaderStatus";
import AdminCredentialsPopup from "./AdminCredentialsPopup";
import SignOutButton from "./SignOutButton";
import { dashboardLabel, roleLabel } from "@/lib/roles";
import { defaultPermissionsForRole } from "@/lib/permissions";

type IconName =
  | "bell"
  | "dashboard"
  | "building"
  | "parking"
  | "shield"
  | "reader"
  | "gate"
  | "card"
  | "activity"
  | "visitor"
  | "report"
  | "admin";

function NavIcon({ name }: { name: IconName }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "bell") return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>;
  if (name === "dashboard") return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
  if (name === "building") return <svg {...common}><path d="M4 21V5.5L12 3v18"/><path d="M12 8h8v13"/><path d="M7 8h2M7 12h2M7 16h2M15 11h2M15 15h2M3 21h18"/></svg>;
  if (name === "parking") return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 17V7h4.2a3.2 3.2 0 0 1 0 6.4H9"/><path d="M9 13.4h4.2"/></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 3 19 6v5c0 4.6-2.9 8.3-7 10-4.1-1.7-7-5.4-7-10V6l7-3Z"/><path d="m9.2 12 1.8 1.8 4-4"/></svg>;
  if (name === "reader") return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 7h6M8 17h8"/><path d="M9 11.5c1.6-1.5 4.4-1.5 6 0M10.5 14c.8-.7 2.2-.7 3 0"/></svg>;
  if (name === "gate") return <svg {...common}><path d="M4 21V5h16v16"/><path d="M8 21V9h8v12M8 13h8M8 17h8"/></svg>;
  if (name === "card") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18M7 14h4"/></svg>;
  if (name === "activity") return <svg {...common}><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>;
  if (name === "visitor") return <svg {...common}><circle cx="9" cy="8" r="3.5"/><path d="M3.5 20c.7-4 2.6-6 5.5-6s4.8 2 5.5 6"/><path d="M17 9v6M14 12h6"/></svg>;
  if (name === "report") return <svg {...common}><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6M9 18h4"/></svg>;
  return <svg {...common}><circle cx="12" cy="8" r="3.5"/><path d="M5 21c.8-4.1 3.2-6 7-6s6.2 1.9 7 6"/><path d="M17.5 5.5 19 4m-1.5 6.5L19 12"/></svg>;
}

function NavRow({
  icon,
  label,
  end,
}: {
  icon: IconName;
  label: ReactNode;
  end?: ReactNode;
}) {
  return <>
    <span className="sidebar-nav-icon"><NavIcon name={icon} /></span>
    <span className="sidebar-nav-label">{label}</span>
    {end ? <span className="sidebar-nav-end">{end}</span> : null}
  </>;
}

export default function Sidebar({
  role = "SUPER_ADMIN",
  dashboardHref = "/dashboard",
  canCreateSuperAdmins = false,
  permissions,
}: {
  role?: UserRole;
  dashboardHref?: string;
  canCreateSuperAdmins?: boolean;
  permissions?: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const assigned = new Set(permissions ?? defaultPermissionsForRole(role));
  const isSuperAdmin = role === "SUPER_ADMIN";

  const dashboardPageActive = pathname === dashboardHref || pathname.startsWith(`${dashboardHref}/`);
  const supervisorParkingActive = role === "EMPLOYEE" && (pathname === "/dashboard/employee-parking" || pathname.startsWith("/dashboard/employee-parking/"));
  const adminParkingActive = role === "BUILDING_ADMIN" && (pathname === "/dashboard/parking-allocation" || pathname.startsWith("/dashboard/parking-allocation/"));
  const companyParkingActive = (role === "COMPANY_ADMIN" || role === "BUILDING_OWNER") && (pathname === "/dashboard/company-parking" || pathname.startsWith("/dashboard/company-parking/"));
  const supervisorManagementActive = role === "BUILDING_ADMIN" && (pathname === "/dashboard/supervisor" || pathname.startsWith("/dashboard/supervisor/"));
  const dashboardLinkActive = role === "EMPLOYEE" || role === "BUILDING_ADMIN" || role === "COMPANY_ADMIN" || role === "BUILDING_OWNER"
    ? pathname === dashboardHref
    : dashboardPageActive;
  const superAdminsActive = pathname === "/super-admins" || pathname.startsWith("/super-admins/");
  const dashboardGroupActive = dashboardPageActive || superAdminsActive;
  const accessGroupActive = pathname === "/access-control" || pathname.startsWith("/access-control/");
  const visitorFormActive = pathname === "/visitor-form" || pathname.startsWith("/visitor-form/");
  const reportsActive = pathname === "/reports" || pathname.startsWith("/reports/");

  const [expanded, setExpanded] = useState({
    dashboard: dashboardGroupActive,
    access: accessGroupActive,
  });

  useEffect(() => {
    setExpanded((current) => ({
      dashboard: dashboardGroupActive ? true : current.dashboard,
      access: accessGroupActive ? true : current.access,
    }));
    setMobileOpen(false);
  }, [pathname, dashboardGroupActive, accessGroupActive]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  function toggle(section: keyof typeof expanded) {
    setExpanded((current) => ({ ...current, [section]: !current[section] }));
  }

  const accessAllowed = (key: string) => isSuperAdmin || role === "BUILDING_ADMIN" && assigned.has(key);
  const showAccess = ["configureReaders", "configureGates", "registerCompanyCards", "liveMonitor", "blockCards"].some(key => accessAllowed("building." + key));
  const showSupervisorParking = role === "EMPLOYEE" && assigned.has("supervisor.employeeParking");
  const showAdminParking = role === "BUILDING_ADMIN"
    && assigned.has("building.allocateCompanyParking")
    && assigned.has("building.manageOwnerParking");
  const showCompanyParking = (role === "COMPANY_ADMIN" || role === "BUILDING_OWNER")
    && assigned.has("company.allocateEmployeeParking");
  const showSupervisorManagement = role === "BUILDING_ADMIN" && assigned.has("building.manageSupervisor");
  const showVisitorForm = role === "BUILDING_ADMIN" && assigned.has("building.manageVisitors") || (role === "COMPANY_ADMIN" || role === "BUILDING_OWNER") && assigned.has("company.manageVisitors");
  const showReports = isSuperAdmin
    || (role === "BUILDING_ADMIN" && assigned.has("building.viewReports"))
    || ((role === "COMPANY_ADMIN" || role === "BUILDING_OWNER") && assigned.has("company.viewReports"))
    || (role === "EMPLOYEE" && assigned.has("supervisor.viewReports"));
  const showReaderStatus = showAccess || (role === "EMPLOYEE" && assigned.has("supervisor.readerStatus"));
  const roleClass = `sidebar-${role.toLowerCase().replaceAll("_", "-")}`;
  const isAccessPage = (href: string) => pathname === href || (href !== "/access-control" && pathname.startsWith(href + "/"));

  const dashboardIcon: IconName = role === "SUPER_ADMIN"
    ? "building"
    : role === "EMPLOYEE"
      ? "activity"
      : "dashboard";

  return <>
    <header className="mobile-site-nav">
      <button
        type="button"
        className="mobile-menu-button"
        aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((open) => !open)}
      >
        <span />
        <span />
        <span />
      </button>

      <strong className="mobile-site-name">SRTEC Access Control</strong>

      <div className="mobile-site-actions">
        <button type="button" className="mobile-back-button" onClick={() => router.back()}>
          <span aria-hidden="true">←</span>
          Back
        </button>
        <SignOutButton className="mobile-signout-button" />
      </div>
    </header>

    {mobileOpen ? <button
      type="button"
      className="mobile-nav-backdrop"
      aria-label="Close navigation menu"
      onClick={() => setMobileOpen(false)}
    /> : null}

    <aside className={`sidebar sidebar-shell ${roleClass}${mobileOpen ? " mobile-open" : ""}`}>
    <div className="sidebar-brand">
      <div className="logo-box" aria-hidden="true">S</div>
      <div className="sidebar-brand-copy">
        <strong>SRTEC Access Control</strong>
        {role === "BUILDING_ADMIN" ? <AdminCredentialsPopup /> : <span className="sidebar-role-pill">{roleLabel(role)}</span>}
      </div>
      <button
        type="button"
        className="sidebar-mobile-close"
        aria-label="Close navigation menu"
        onClick={() => setMobileOpen(false)}
      >
        ×
      </button>
    </div>

    <div className="sidebar-divider" />

    <nav
      className="sidebar-nav"
      aria-label="Main navigation"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("a")) setMobileOpen(false);
      }}
    >
      <div className="sidebar-nav-group">
        <button
          type="button"
          className={`sidebar-nav-parent${dashboardGroupActive ? " is-active" : ""}`}
          aria-expanded={expanded.dashboard}
          aria-controls="dashboard-menu"
          onClick={() => toggle("dashboard")}
        >
          <NavRow
            icon="dashboard"
            label="Dashboard"
            end={<span className={`sidebar-chevron${expanded.dashboard ? " is-open" : ""}`} aria-hidden="true" />}
          />
        </button>

        <div
          id="dashboard-menu"
          className={`sidebar-submenu${expanded.dashboard ? " is-open" : ""}`}
          hidden={!expanded.dashboard}
        >
          <Link
            className={`sidebar-submenu-link${dashboardLinkActive ? " is-active" : ""}`}
            href={dashboardHref}
          >
            <NavRow icon={dashboardIcon} label={dashboardLabel(role)} />
          </Link>

          {showAdminParking ? <Link
            className={`sidebar-submenu-link${adminParkingActive ? " is-active" : ""}`}
            href="/dashboard/parking-allocation"
          >
            <NavRow icon="parking" label="Parking allocation" />
          </Link> : null}

          {showCompanyParking ? <Link
            className={`sidebar-submenu-link${companyParkingActive ? " is-active" : ""}`}
            href="/dashboard/company-parking"
          >
            <NavRow icon="parking" label="Parking allocation" />
          </Link> : null}

          {showSupervisorParking ? <Link
            className={`sidebar-submenu-link${supervisorParkingActive ? " is-active" : ""}`}
            href="/dashboard/employee-parking"
          >
            <NavRow icon="parking" label="Employee parking" />
          </Link> : null}

          {showSupervisorManagement ? <Link
            className={`sidebar-submenu-link${supervisorManagementActive ? " is-active" : ""}`}
            href="/dashboard/supervisor"
          >
            <NavRow icon="admin" label="Supervisor" />
          </Link> : null}

          {canCreateSuperAdmins ? <Link
            className={`sidebar-submenu-link${superAdminsActive ? " is-active" : ""}`}
            href="/super-admins"
          >
            <NavRow icon="admin" label="Create Super Admin" />
          </Link> : null}
        </div>
      </div>

      {(isSuperAdmin || role === "BUILDING_ADMIN" && assigned.has("building.approveManualExit")) && <Link href="/notifications" className={`sidebar-nav-parent${pathname === "/notifications" ? " is-active" : ""}`}>
        <NavRow icon="bell" label="Notifications" end={<NotificationBadge />} />
      </Link>}

      {showAccess ? <div className="sidebar-nav-group">
        <button
          type="button"
          className={`sidebar-nav-parent${accessGroupActive ? " is-active" : ""}`}
          aria-expanded={expanded.access}
          aria-controls="access-menu"
          onClick={() => toggle("access")}
        >
          <NavRow
            icon="shield"
            label="Access Control"
            end={<span className={`sidebar-chevron${expanded.access ? " is-open" : ""}`} aria-hidden="true" />}
          />
        </button>

        <div
          id="access-menu"
          className={`sidebar-submenu${expanded.access ? " is-open" : ""}`}
          hidden={!expanded.access}
        >
          {accessAllowed("building.configureReaders") ? <Link
            className={`sidebar-submenu-link${isAccessPage("/access-control") ? " is-active" : ""}`}
            href="/access-control"
          >
            <NavRow icon="reader" label="Device / Reader" />
          </Link> : null}
          {accessAllowed("building.configureGates") ? <Link
            className={`sidebar-submenu-link${isAccessPage("/access-control/gate-details") ? " is-active" : ""}`}
            href="/access-control/gate-details"
          >
            <NavRow icon="gate" label="Gate Details" />
          </Link> : null}
          {accessAllowed("building.registerCompanyCards") ? <Link
            className={`sidebar-submenu-link${isAccessPage("/access-control/register-cards") ? " is-active" : ""}`}
            href="/access-control/register-cards"
          >
            <NavRow icon="card" label="Register cards" />
          </Link> : null}
          {accessAllowed("building.liveMonitor") ? <Link
            className={`sidebar-submenu-link${isAccessPage("/access-control/activity") ? " is-active" : ""}`}
            href="/access-control/activity"
          >
            <NavRow icon="activity" label="Real Time Monitor" />
          </Link> : null}
          {role === "BUILDING_ADMIN" && assigned.has("building.blockCards") ? <Link
            className={`sidebar-submenu-link${isAccessPage("/access-control/card-block") ? " is-active" : ""}`}
            href="/access-control/card-block"
          >
            <NavRow icon="card" label="Card Block" />
          </Link> : null}
        </div>
      </div> : null}

      {showVisitorForm ? <Link
        className={`sidebar-nav-link${visitorFormActive ? " is-active" : ""}`}
        href="/visitor-form"
      >
        <NavRow icon="visitor" label="Visitor Form" />
      </Link> : null}

      {isSuperAdmin ? <Link
        className={`sidebar-nav-link${pathname === "/offline-sync" ? " is-active" : ""}`}
        href="/offline-sync"
        aria-current={pathname === "/offline-sync" ? "page" : undefined}
      >
        <NavRow icon="reader" label="Offline Sync" />
      </Link> : null}

      {showReports ? <Link
        className={`sidebar-nav-link${reportsActive ? " is-active" : ""}`}
        href="/reports"
      >
        <NavRow icon="report" label="Reports" />
      </Link> : null}
    </nav>

    {showReaderStatus
      ? (role === "EMPLOYEE"
        ? <SidebarReaderStatus endpoint="/api/supervisor/readers" title="Allotted Reader" linkToAccess={false} />
        : <SidebarReaderStatus />)
      : null}

    <style>{`
      .mobile-site-nav,
      .mobile-nav-backdrop,
      .sidebar-mobile-close{display:none}

      .sidebar-shell{
        --sidebar-bg:#ffffff;
        --sidebar-blue:#1769c2;
        --sidebar-blue-dark:#0f4f97;
        --sidebar-blue-soft:#eaf3ff;
        --sidebar-blue-softer:#f5f9ff;
        --sidebar-text:#1769c2;
        --sidebar-muted:#5f7fa4;
        --sidebar-line:#d9e6f3;
        height:100vh;
        min-height:100vh;
        position:sticky;
        top:0;
        overflow:hidden;
        padding:14px 12px 11px;
        background:#fff;
        color:var(--sidebar-text);
        border-right:1px solid #dfe9f4;
        box-shadow:7px 0 24px rgba(38,83,128,.07);
      }

      .sidebar-shell .sidebar-brand{
        display:flex;
        align-items:center;
        gap:10px;
        padding:2px 5px 12px;
      }

      .sidebar-shell .logo-box{
        width:39px;
        height:39px;
        flex:0 0 39px;
        display:grid;
        place-items:center;
        border:1px solid #c9dcf1;
        border-radius:10px;
        background:linear-gradient(145deg,#2476cf,#0f5cad);
        color:#fff;
        font-size:16px;
        font-weight:900;
        box-shadow:0 7px 16px rgba(23,105,194,.18);
      }

      .sidebar-brand-copy{
        min-width:0;
        display:grid;
        gap:5px;
      }

      .sidebar-brand-copy strong{
        color:var(--sidebar-blue-dark);
        font-size:12.5px;
        line-height:1.2;
        letter-spacing:.1px;
      }

      .sidebar-role-pill{
        justify-self:start;
        display:inline-flex!important;
        align-items:center;
        min-height:18px;
        margin:0!important;
        padding:3px 7px;
        border:1px solid #cfe0f2;
        border-radius:999px;
        background:#eef6ff;
        color:var(--sidebar-blue)!important;
        font-size:10px!important;
        font-weight:800;
        letter-spacing:.35px;
        text-transform:uppercase;
      }

      .sidebar-divider{
        height:1px;
        margin:0 3px 11px;
        background:linear-gradient(90deg,transparent,var(--sidebar-line) 12%,var(--sidebar-line) 88%,transparent);
      }

      .sidebar-shell .sidebar-nav{
        flex:1 1 auto;
        min-height:0;
        display:flex;
        flex-direction:column;
        gap:6px;
        overflow-y:auto;
        overflow-x:hidden;
        padding:0 1px 10px;
        scrollbar-width:none;
      }

      .sidebar-shell .sidebar-nav::-webkit-scrollbar{display:none}

      .sidebar-nav-group{
        display:grid;
        gap:4px;
      }

      .sidebar-nav-parent,
      .sidebar-nav-link,
      .sidebar-submenu-link{
        width:100%;
        min-width:0;
        display:grid;
        grid-template-columns:28px minmax(0,1fr) auto;
        align-items:center;
        gap:7px;
        border:0;
        text-align:left;
        text-decoration:none;
        transition:background .15s ease,color .15s ease,transform .15s ease,border-color .15s ease,box-shadow .15s ease;
      }

      .sidebar-nav-parent,
      .sidebar-nav-link{
        min-height:40px;
        padding:7px 9px;
        border:1px solid transparent;
        border-radius:9px;
        background:transparent;
        color:var(--sidebar-blue);
        font-size:13px;
        font-weight:750;
      }

      .sidebar-nav-parent:hover,
      .sidebar-nav-link:hover{
        background:var(--sidebar-blue-softer);
        color:var(--sidebar-blue-dark);
        border-color:#d8e7f6;
      }

      .sidebar-nav-parent.is-active,
      .sidebar-nav-link.is-active{
        border-color:#c4daf1;
        background:linear-gradient(90deg,#e6f1ff 0%,#f6faff 100%);
        color:var(--sidebar-blue-dark);
        box-shadow:inset 3px 0 0 var(--sidebar-blue);
      }

      .sidebar-nav-icon{
        width:28px;
        height:28px;
        display:grid;
        place-items:center;
        border-radius:7px;
        color:var(--sidebar-blue);
        background:#f2f7fd;
      }

      .is-active>.sidebar-nav-icon,
      .sidebar-nav-parent.is-active .sidebar-nav-icon{
        color:#fff;
        background:var(--sidebar-blue);
      }

      .sidebar-nav-label{
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        color:inherit;
      }

      .sidebar-nav-end{
        display:grid;
        place-items:center;
        color:var(--sidebar-blue);
      }

      .sidebar-chevron{
        width:7px;
        height:7px;
        display:block;
        border-right:1.8px solid currentColor;
        border-bottom:1.8px solid currentColor;
        transform:rotate(45deg) translate(-1px,-1px);
        transform-origin:center;
        transition:transform .2s ease;
        opacity:1;
        color:var(--sidebar-blue);
      }

      .sidebar-chevron.is-open{
        transform:rotate(225deg) translate(-1px,-1px);
      }

      .sidebar-submenu{
        position:relative;
        display:grid;
        gap:3px;
        padding:2px 0 3px 15px;
      }

      .sidebar-submenu[hidden]{display:none}

      .sidebar-submenu:before{
        content:"";
        position:absolute;
        left:14px;
        top:4px;
        bottom:6px;
        width:1px;
        background:#bfd6ee;
      }

      .sidebar-submenu-link{
        position:relative;
        min-height:34px;
        margin-left:7px;
        width:calc(100% - 7px);
        padding:5px 8px 5px 10px;
        border:1px solid transparent;
        border-radius:8px;
        color:var(--sidebar-blue);
        background:transparent;
        font-size:12px;
        font-weight:650;
      }

      .sidebar-submenu-link:before{
        content:"";
        position:absolute;
        left:-9px;
        top:50%;
        width:8px;
        height:1px;
        background:#bfd6ee;
      }

      .sidebar-submenu-link .sidebar-nav-icon{
        width:25px;
        height:25px;
        border-radius:6px;
        background:#f3f8fe;
        color:var(--sidebar-blue);
      }

      .sidebar-submenu-link:hover{
        background:#f2f7fd;
        color:var(--sidebar-blue-dark);
        border-color:#dce9f6;
      }

      .sidebar-submenu-link.is-active{
        border-color:#bcd5ef;
        background:#e8f2ff;
        color:var(--sidebar-blue-dark);
        box-shadow:0 4px 12px rgba(23,105,194,.10);
        font-weight:800;
      }

      .sidebar-submenu-link.is-active .sidebar-nav-icon{
        background:var(--sidebar-blue);
        color:#fff;
      }

      .sidebar-shell :global(.sidebar-reader-status){
        flex:0 0 auto;
        margin-top:7px!important;
        padding:10px 6px 1px!important;
        border-top:1px solid #dbe7f3!important;
      }

      .sidebar-shell :global(.sidebar-reader-title){
        color:var(--sidebar-blue)!important;
        font-size:10.5px!important;
        letter-spacing:.35px;
        text-transform:uppercase;
      }

      .sidebar-shell :global(.sidebar-reader-item){
        color:var(--sidebar-blue)!important;
        font-size:11px!important;
      }

      .sidebar-shell :global(.sidebar-reader-item strong){
        color:var(--sidebar-blue-dark)!important;
      }

      .sidebar-shell :global(.sidebar-reader-empty){
        color:#7897b8!important;
      }

      .sidebar-nav-parent:focus-visible,
      .sidebar-nav-link:focus-visible,
      .sidebar-submenu-link:focus-visible{
        outline:2px solid #5f9dde;
        outline-offset:2px;
      }

      @media(max-height:760px) and (min-width:951px){
        .sidebar-shell{padding-top:10px;padding-bottom:8px}
        .sidebar-shell .sidebar-brand{padding-bottom:8px}
        .sidebar-divider{margin-bottom:8px}
        .sidebar-shell .sidebar-nav{gap:4px}
        .sidebar-nav-parent,.sidebar-nav-link{min-height:35px;padding:5px 8px}
        .sidebar-nav-icon{width:25px;height:25px}
        .sidebar-submenu-link{min-height:30px;padding-top:3px;padding-bottom:3px}
        .sidebar-submenu-link .sidebar-nav-icon{width:23px;height:23px}
      }

      @media(max-width:950px){
        .mobile-site-nav{
          position:sticky;
          top:0;
          z-index:10001;
          display:grid;
          grid-template-columns:40px minmax(0,1fr) auto;
          align-items:center;
          gap:9px;
          min-height:58px;
          padding:8px 10px;
          border-bottom:1px solid #d7e4f1;
          background:rgba(255,255,255,.97);
          box-shadow:0 5px 18px rgba(37,76,116,.10);
          backdrop-filter:blur(10px);
        }

        .mobile-menu-button{
          width:38px;
          height:38px;
          display:grid;
          align-content:center;
          justify-items:center;
          gap:4px;
          padding:0;
          border:1px solid #c8dcf1;
          border-radius:9px;
          background:#eef6ff;
          color:#1769c2;
        }

        .mobile-menu-button span{
          width:17px;
          height:2px;
          border-radius:999px;
          background:currentColor;
          transition:transform .18s ease,opacity .18s ease;
        }

        .mobile-menu-button[aria-expanded="true"] span:nth-child(1){transform:translateY(6px) rotate(45deg)}
        .mobile-menu-button[aria-expanded="true"] span:nth-child(2){opacity:0}
        .mobile-menu-button[aria-expanded="true"] span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}

        .mobile-site-name{
          min-width:0;
          overflow:hidden;
          color:#0f4f97;
          font-size:14px;
          font-weight:900;
          text-overflow:ellipsis;
          white-space:nowrap;
        }

        .mobile-site-actions{
          display:flex;
          align-items:center;
          gap:6px;
        }

        .mobile-back-button,
        .mobile-signout-button{
          min-height:34px!important;
          padding:7px 9px!important;
          border:1px solid #c7d8e9!important;
          border-radius:8px!important;
          background:#fff!important;
          color:#1769c2!important;
          font-size:12px!important;
          font-weight:800!important;
          white-space:nowrap;
          box-shadow:none!important;
        }

        .mobile-back-button{
          display:inline-flex;
          align-items:center;
          gap:4px;
        }

        .mobile-nav-backdrop{
          position:fixed;
          inset:0;
          z-index:10002;
          display:block;
          padding:0;
          border:0;
          background:rgba(16,35,54,.36);
          backdrop-filter:blur(2px);
        }

        .sidebar-shell{
          position:fixed;
          top:0;
          bottom:0;
          left:0;
          z-index:10003;
          width:min(86vw,300px);
          height:100dvh;
          min-height:100dvh;
          overflow:hidden;
          padding:14px 12px 11px;
          border-right:1px solid #dfe9f4;
          border-bottom:0;
          border-radius:0 14px 14px 0;
          box-shadow:18px 0 45px rgba(20,53,84,.20);
          transform:translateX(-105%);
          transition:transform .22s ease;
        }

        .sidebar-shell.mobile-open{transform:translateX(0)}

        .sidebar-shell .sidebar-brand{
          padding-right:38px;
        }

        .sidebar-mobile-close{
          position:absolute;
          top:14px;
          right:12px;
          width:30px;
          height:30px;
          place-items:center;
          padding:0;
          border:1px solid #d3e1ef;
          border-radius:50%;
          background:#f5f9ff;
          color:#1769c2;
          font-size:20px;
          line-height:1;
        }

        .sidebar-shell.mobile-open .sidebar-mobile-close{display:grid}

        .sidebar-shell .sidebar-nav{
          overflow-y:auto;
          overflow-x:hidden;
          padding-bottom:8px;
        }

        .sidebar-shell :global(.sidebar-reader-status){
          margin-top:10px!important;
        }

        .dashboard-main .topbar{
          gap:8px;
          padding-bottom:12px;
        }

        .dashboard-main .topbar .section-kicker{display:none}
        .dashboard-main .topbar h1{margin:0;font-size:22px}
        .dashboard-main .topbar .summary-card{display:none}
        .dashboard-main .topbar .topbar-right form[action="/api/logout"]{display:none}
        .dashboard-main .topbar .topbar-right .link-button{display:none}
      }

      @media(prefers-reduced-motion:reduce){
        .sidebar-nav-parent,
        .sidebar-nav-link,
        .sidebar-submenu-link,
        .sidebar-chevron{transition:none}
      }
    `}</style>
    </aside>
  </>;
}
