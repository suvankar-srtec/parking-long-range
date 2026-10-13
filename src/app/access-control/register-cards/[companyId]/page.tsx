import { notFound, redirect } from "next/navigation";
import AppLink from "@/components/AppLink";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import RegisterCardsEmployeeSearch from "@/components/RegisterCardsEmployeeSearch";
import EmployeeCreateModal from "@/components/EmployeeCreateModal";
import { getCurrentUser } from "@/lib/session";
import { effectivePermissions, hasPermission } from "@/lib/permissions";
import { companyCardScope } from "@/lib/company-card-access";
import { prisma } from "@/lib/prisma";
import styles from "./page.module.css";

export default async function CompanyCardsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) redirect("/dashboard");
  if (user.role === "BUILDING_ADMIN" && !hasPermission(user, "building.registerCompanyCards")) redirect("/dashboard");
  const { companyId } = await params;
  const company = await prisma.company.findFirst({
    where: { AND: [{ id: companyId }, companyCardScope(user)] },
    select: {
      id: true, name: true, buildingId: true, maximumDepartments: true,
      building: { select: { name: true, enabled: true } },
      departments: {
        where: { NOT: { name: { startsWith: "__ARCHIVED__" } } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
      employees: {
        where: { isPlaceholder: false }, orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true, name: true, userId: true, category: true, department: true, parkingLimit: true,
          vehicles: { orderBy: { createdAt: "asc" }, select: { id: true, plateNumber: true, rfidCardNo: true, isInside: true } },
        },
      },
    },
  });
  if (!company) notFound();
  const registered = company.employees.filter(person => person.vehicles.some(vehicle => vehicle.rfidCardNo)).length;

  return <main className="dashboard-page">
    <Sidebar role={user.role} permissions={effectivePermissions(user)} />
    <section className="dashboard-main">
      <header className="topbar">
        <div><div className="section-kicker">REGISTER RFID CARDS</div><h1>{company.name}</h1><p className={styles.building}>{company.building.name}</p></div>
        <div className="topbar-right"><AppLink href="/access-control/register-cards" className="secondary-button">← All companies</AppLink>
          {user.role === "BUILDING_ADMIN" ? <EmployeeCreateModal
            companyId={company.id}
            departments={company.departments}
            maximumDepartments={company.maximumDepartments}
            canManageVehicles
            canRegisterRfid
            disabled={!company.building.enabled}
          /> : null}
          <SignOutButton /></div>
      </header>
      <section className="portfolio-card building-management">
        <div className="portfolio-header">
          <div><div className="section-kicker">COMPANY EMPLOYEES</div><h2>Employees &amp; RFID cards</h2><p>Use Register card to open the employee/company-owner setup flow and continue to vehicle and RFID registration.</p></div>
          <div className={styles.summary}><span><strong>{company.employees.length}</strong> Employees</span><span><strong>{registered}</strong> With cards</span></div>
        </div>
        <div className="portfolio-divider" />
        {!company.building.enabled && <p className={styles.notice}>This building is disabled. Enable it before registering cards.</p>}
        {company.employees.length ? <RegisterCardsEmployeeSearch
          companyId={company.id}
          buildingId={company.buildingId}
          employees={company.employees}
          departments={company.departments}
          maximumDepartments={company.maximumDepartments}
          disabled={!company.building.enabled}
        /> : <div className={styles.empty}>No employees have been added to this company yet.</div>}
      </section>
    </section>
    <style>{`
      .rfid-employee-search{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}
      .rfid-employee-search-field{display:flex;align-items:center;gap:8px;width:min(520px,100%);min-height:42px;padding:0 12px;border:1px solid #cfdad4;border-radius:9px;background:#fff}
      .rfid-employee-search-field>span{color:#7b8780;font-size:18px}
      .rfid-employee-search-field input{width:100%;border:0;outline:0;background:transparent;color:#213128;font:inherit;font-size:12px}
      .rfid-employee-search>span{padding:5px 8px;border-radius:999px;background:#f2edf7;color:#71429d;font-size:9px;font-weight:900;white-space:nowrap}
      .rfid-employee-table-wrap{overflow:auto}
      .rfid-employee-table{width:100%;border-collapse:collapse}
      .rfid-employee-table th,.rfid-employee-table td{padding:14px;border-bottom:1px solid #e2e8e5;text-align:left;font-size:12px}
      .rfid-employee-table thead th{background:#f1f5f3;color:#536159;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
      .rfid-employee-person strong{display:block;font-size:15px;color:#1d2f25}
      .rfid-employee-person span{display:block;margin-top:3px;color:#718078;font-size:10px;font-weight:400}
      .rfid-muted,.rfid-missing{color:#7b8780}
      .rfid-card-number{padding:5px 8px;border-radius:999px;background:#eaf7ef;color:#16824f;font-size:10px}
      .rfid-registered{display:inline-flex;padding:5px 8px;border-radius:999px;background:#eaf7ef;color:#16824f;font-size:10px;font-weight:800}
      .rfid-employee-empty{padding:28px 16px;border:1px dashed #d1dbd5;border-radius:9px;color:#738078;text-align:center;font-size:12px}
    `}</style>
  </main>;
}
