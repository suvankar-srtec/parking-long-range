import SignOutButton from "@/components/SignOutButton";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { roleLabel } from "@/lib/roles";
import { effectivePermissions, hasPermission } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import Sidebar from "@/components/Sidebar";
import BuildingPortfolio from "@/components/BuildingPortfolio";
import BuildingAdminPanel from "@/components/BuildingAdminPanel";
import CompanyList from "@/components/CompanyList";
import EmployeeList from "@/components/EmployeeList";
import EmployeeCreateModal from "@/components/EmployeeCreateModal";
import SupervisorHeadcount from "@/components/SupervisorHeadcount";
import CompanyCredentialsEditor from "@/components/CompanyCredentialsEditor";
import OwnerParkingVehicleModal from "@/components/OwnerParkingVehicleModal";
import OwnerVehicleDetailsList from "@/components/OwnerVehicleDetailsList";

function AssignmentRequired({ title, message }: { title: string; message: string }) {
  return <section className="portfolio-card building-management">
    <div className="portfolio-header"><div><div className="section-kicker">ACCOUNT SETUP</div><h2>{title}</h2><p>{message}</p></div></div>
  </section>;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const permissions = effectivePermissions(user);

  if (user.role === "SUPER_ADMIN") {
    const primary = isPrimarySuperAdmin(user);
    const buildings = await prisma.building.findMany({
      where: primary ? undefined : { superAdminId: user.id },
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { companies: true } },
        users: { where: { role: "BUILDING_ADMIN" }, select: { userId: true, username: true }, take: 1 },
      },
    });
    return <main className="dashboard-page"><Sidebar role={user.role} permissions={permissions} canCreateSuperAdmins={primary} /><section className="dashboard-main">
      <header className="topbar"><div><div className="section-kicker">BUILDING PARKING</div><h1>{primary ? "Building portfolio" : "My buildings"}</h1></div><div className="topbar-right"><div className="summary-card"><span>{roleLabel(user.role)}</span><strong>{user.userId}</strong></div><SignOutButton /></div></header>
      {!primary && buildings.length === 0 ? <section className="portfolio-card building-management"><div className="portfolio-header"><div><div className="section-kicker">GET STARTED</div><h2>Create your first building</h2><p>This Super Admin account is isolated from other Super Admins. Create a building to start managing its Admin, companies, Supervisor, RFID access and reports.</p></div></div></section> : null}
      <BuildingPortfolio buildings={buildings} />
    </section></main>;
  }

  if (user.role === "BUILDING_ADMIN") {
    if (!user.buildingId) return <main className="dashboard-page"><Sidebar role={user.role} permissions={permissions} /><section className="dashboard-main"><header className="topbar"><div><div className="section-kicker">ADMIN</div><h1>Dashboard</h1></div><SignOutButton /></header><AssignmentRequired title="Building not assigned" message="This Admin account must be assigned to a building by a Super Admin before company management is available." /></section></main>;

    const building = await prisma.building.findUnique({
        where: { id: user.buildingId },
        include: {
          ownerVehicles: { select: { id: true, ownerName: true, plateNumber: true, vehicleType: true, rfidCardNo: true, isInside: true }, orderBy: { createdAt: "desc" } },
          companies: {
            orderBy: { createdAt: "asc" },
            include: {
              users: { where: { role: "COMPANY_ADMIN" }, select: { userId: true, username: true, password: true }, take: 1 },
              vehicles: {
                where: { employee: { isPlaceholder: false } },
                select: { id: true },
              },
              employees: { where: { isPlaceholder: false }, select: { id: true, category: true } },
            },
          },
        },
      });
    if (!building) redirect("/");
    const allocated = building.companies.reduce((total, company) => total + company.parkingAllocation, 0);
    const available = Math.max(building.companyParking - allocated, 0);
    const ownerRegistered = building.ownerVehicles.length;
    const ownerInside = building.ownerVehicles.filter((vehicle) => vehicle.isInside).length;
    const ownerAvailable = Math.max(building.ownerParking - ownerInside, 0);
    const canManageOwner = hasPermission(user, "building.manageOwnerParking");
    const canRegisterOwner = hasPermission(user, "building.registerOwnerParking");
    const canCreateCompanies = hasPermission(user, "building.createCompanies");

    return <main className="dashboard-page"><Sidebar role={user.role} permissions={permissions} /><section className="dashboard-main">
      <header className="topbar"><div><h1>{building.name}</h1></div><div className="topbar-right"><SignOutButton /></div></header>
      <section className="portfolio-card building-management">
        <div className="portfolio-header"><div><h2>Parking allocation</h2><p className="parking-formula">Total parking = Owner + Visitor + Company</p></div></div>
        <div className="portfolio-divider" />
        <div className="building-parking-summary">
          <div className="building-parking-row building-parking-row-primary">
            <div className="large-stat"><span>Total parking</span><strong>{building.totalParking}</strong></div>
            <div className="large-stat"><span>Owner parking</span><strong>{building.ownerParking}</strong></div>
            <div className="large-stat"><span>Visitor parking</span><strong>{building.visitorParking}</strong></div>
            <div className="large-stat"><span>Company parking</span><strong>{building.companyParking}</strong></div>
            <div className="large-stat maximum-gate-stat"><span>Maximum Gates</span><strong>{building.maximumGate}</strong></div>
          </div>
          <div className="building-parking-row building-parking-row-secondary">
            <div className="large-stat"><span>Allotted</span><strong>{allocated}</strong></div>
            <div className="large-stat"><span>Available</span><strong>{available}</strong></div>
          </div>
        </div>
        <style>{`
          .parking-formula{margin:5px 0 0;color:#52667d;font-size:13px;font-weight:700}.building-parking-summary{display:grid;gap:10px;margin-top:10px}.building-parking-row{display:grid;gap:10px}.building-parking-row-primary{grid-template-columns:repeat(5,minmax(0,1fr))}.building-parking-row-secondary{grid-template-columns:repeat(2,minmax(0,1fr))}.building-parking-summary .large-stat{min-width:0}.building-parking-summary .maximum-gate-stat{background:#eaf3ff;border-color:#9fc5ec}.building-parking-summary .maximum-gate-stat span,.building-parking-summary .maximum-gate-stat strong{color:#0f4f97}.owner-parking-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px}.owner-parking-stats{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:10px;flex:1}.owner-vehicle-list{display:grid;gap:8px;margin-top:14px}.owner-vehicle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid #dbe3df;border-radius:10px;background:#fafcfb}.owner-vehicle-row span{font-size:12px;color:#647168}.owner-vehicle-row strong{font-size:13px}@media(max-width:1000px){.building-parking-row-primary{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.building-parking-row-primary,.building-parking-row-secondary{grid-template-columns:1fr}.owner-parking-toolbar{align-items:stretch;flex-direction:column}.owner-parking-stats{grid-template-columns:1fr}}
        `}</style>
      </section>

      {(canManageOwner || canRegisterOwner) ? <section className="portfolio-card building-management">
        <div className="portfolio-header">
          <div><h2>Owner Parking Vehicles</h2></div>
          {canRegisterOwner ? <OwnerParkingVehicleModal buildingId={building.id} ownerParking={building.ownerParking} registeredVehicles={ownerRegistered} /> : null}
        </div>
        <div className="portfolio-divider" />
        <div className="owner-parking-toolbar"><div className="owner-parking-stats"><div className="large-stat"><span>Allotted</span><strong>{building.ownerParking}</strong></div><div className="large-stat"><span>Registered</span><strong>{ownerRegistered}</strong></div><div className="large-stat"><span>Available</span><strong>{ownerAvailable}</strong></div></div><div className="large-stat"><span>Vehicles In</span><strong>{ownerInside}</strong></div></div>
        {canManageOwner && building.ownerVehicles.length
          ? <OwnerVehicleDetailsList vehicles={building.ownerVehicles} />
          : canManageOwner
            ? <p className="muted">No Owner Parking vehicles registered yet.</p>
            : null}
      </section> : null}

      <section className="portfolio-card building-management"><CompanyList
        companies={building.companies.map(company => ({ ...company, users: company.users.map(account => ({ ...account, password: hasPermission(user, "building.manageCompanyAccounts") ? account.password : undefined })) }))}
        companyParking={building.companyParking}
        showUserId
        showPassword={hasPermission(user, "building.manageCompanyAccounts")}
        canManageStatus={hasPermission(user, "building.manageCompanyAccounts")}
        canEditParking={hasPermission(user, "building.allocateCompanyParking")}
        integratedHeader
        headerAction={canCreateCompanies ? <BuildingAdminPanel buildingId={building.id} /> : null}
      /></section>
    </section></main>;
  }

  if (user.role === "COMPANY_ADMIN" || user.role === "BUILDING_OWNER") {
    if (!user.companyId) return <main className="dashboard-page"><Sidebar role={user.role} permissions={permissions} /><section className="dashboard-main"><header className="topbar"><div><div className="section-kicker">{roleLabel(user.role).toUpperCase()}</div><h1>Dashboard</h1></div><SignOutButton /></header><AssignmentRequired title="Company not assigned" message="This account must be linked to a company before parking allocation is available." /></section></main>;

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      include: {
        building: { select: { name: true } },
        departments: {
          where: { NOT: { name: { startsWith: "__ARCHIVED__" } } },
          orderBy: { name: "asc" },
        },
        employees: {
          where: {
            OR: [
              { isPlaceholder: false },
              { isPlaceholder: true, slotNumber: { not: null } },
            ],
          },
          orderBy: { createdAt: "asc" },
          include: { vehicles: true },
        },
      },
    });
    if (!company) redirect("/");

    if (!company.enabled) {
      return <main className="dashboard-page"><Sidebar role={user.role} permissions={permissions} /><section className="dashboard-main">
        <header className="topbar">
          <div><div className="section-kicker">{roleLabel(user.role).toUpperCase()}</div><h1>Company disabled</h1></div>
          <div className="topbar-right"><div className="summary-card"><span>Building</span><strong>{company.building.name}</strong></div><SignOutButton /></div>
        </header>
        <AssignmentRequired
          title="Company disabled"
          message="This company is currently disabled. Its employees, company owners, vehicles and parking allocation are hidden from the active dashboard, but all existing company and employee data remains stored in the database and will appear again when the Building Admin enables the company."
        />
      </section></main>;
    }

    const peopleCount = company.employees.filter((employee) => !employee.isPlaceholder).length;
    const used = company.employees.reduce((total, employee) => total + employee.vehicles.length, 0);
    const available = Math.max(company.parkingAllocation - used, 0);
    const canViewUsage = hasPermission(user, "company.viewUsage");
    const canManagePeople = hasPermission(user, "company.managePeople");
    const canAllocateParking = hasPermission(user, "company.allocateEmployeeParking");
    const canManageVehicles = hasPermission(user, "company.manageVehicles");
    const canRegisterRfid = hasPermission(user, "company.registerRfid");

    return <main className="dashboard-page"><Sidebar role={user.role} permissions={permissions} /><section className="dashboard-main">
      <header className="topbar"><div><div className="section-kicker">{roleLabel(user.role).toUpperCase()}</div><h1>{company.name}</h1></div><div className="topbar-right"><div className="summary-card"><span>Building</span><strong>{company.building.name}</strong></div><SignOutButton /></div></header>
      {canViewUsage ? <section className="portfolio-card building-management"><div className="portfolio-header"><div><div className="section-kicker">COMPANY PARKING</div><h2>Parking allocation</h2><p>Company parking usage available to this account.</p></div></div><div className="portfolio-divider" /><CompanyCredentialsEditor userId={user.userId} companyName={company.name} initialPassword={user.password} /><div className="account-parking-grid account-company-parking-grid"><div className="large-stat"><span>Company limit</span><strong>{company.parkingAllocation}</strong></div><div className="large-stat"><span>Visitor parking</span><strong>{company.visitorParkingAllocation}</strong></div><div className="large-stat"><span>Total people</span><strong>{peopleCount}</strong></div><div className="large-stat"><span>Registered vehicles</span><strong>{used}</strong></div><div className="large-stat"><span>Unassigned</span><strong>{available}</strong></div></div></section> : null}
      {(canManagePeople || canManageVehicles) ? <section className="portfolio-card building-management"><div className="employee-section-header"><div><div className="section-kicker">PEOPLE</div><h2>Employees & Company Owners</h2></div>{canManagePeople ? <EmployeeCreateModal companyId={company.id} departments={company.departments} maximumDepartments={company.maximumDepartments} canManageVehicles={canManageVehicles} canRegisterRfid={canRegisterRfid} /> : null}</div><div className="portfolio-divider" /><EmployeeList companyId={company.id} employees={company.employees} departments={company.departments} /></section> : null}
    </section></main>;
  }

  const showTotalOnSite = hasPermission(user, "supervisor.totalOnSite");
  const showTotalIn = hasPermission(user, "supervisor.totalIn");
  const showTotalOut = hasPermission(user, "supervisor.totalOut");
  const showLiveDashboard = hasPermission(user, "supervisor.liveDashboard");
  const showActivity = hasPermission(user, "supervisor.activity");

  return <main className="dashboard-page"><Sidebar role={user.role} permissions={permissions} /><section className="dashboard-main">
    <header className="topbar"><div><div className="section-kicker">SUPERVISOR</div><h1>Real Time Monitor</h1></div><div className="topbar-right"><div className="summary-card"><span>User ID</span><strong>{user.userId}</strong></div><SignOutButton /></div></header>
    {user.buildingId ? <SupervisorHeadcount showTotalOnSite={showTotalOnSite} showTotalIn={showTotalIn} showTotalOut={showTotalOut} showLiveDashboard={showLiveDashboard} showActivity={showActivity} /> : <AssignmentRequired title="Building not assigned" message="This Supervisor must be assigned to a building before the Real Time Monitor and reports are available." />}
  </section></main>;
}
