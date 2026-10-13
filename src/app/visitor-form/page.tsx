import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import VisitorForm from "@/components/VisitorForm";
import VisitorTable from "@/components/VisitorTable";
import { prisma } from "@/lib/prisma";
import { effectivePermissions, hasPermission } from "@/lib/permissions";
import { roleLabel } from "@/lib/roles";
import { getCurrentUser } from "@/lib/session";

function formatVisitorTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

export default async function VisitorFormPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const isBuildingAdmin = user.role === "BUILDING_ADMIN";
  const isCompanyUser = user.role === "COMPANY_ADMIN" || user.role === "BUILDING_OWNER";
  if (!isBuildingAdmin && !isCompanyUser) redirect("/dashboard");

  if (!hasPermission(user, isBuildingAdmin ? "building.manageVisitors" : "company.manageVisitors")) redirect("/dashboard");
  const permissions = effectivePermissions(user);
  let scopeLabel = "Building";
  let scopeName = "";
  let visitorWhere: { buildingId: string; companyId: null } | { companyId: string };

  if (isBuildingAdmin) {
    if (!user.buildingId) redirect("/dashboard");
    const building = await prisma.building.findUnique({
      where: { id: user.buildingId },
      select: { name: true },
    });
    if (!building) redirect("/dashboard");
    scopeName = building.name;
    visitorWhere = { buildingId: user.buildingId, companyId: null };
  } else {
    if (!user.companyId) redirect("/dashboard");
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true, enabled: true, building: { select: { name: true } } },
    });
    if (!company || !company.enabled) redirect("/dashboard");
    scopeLabel = "Company";
    scopeName = company.name;
    visitorWhere = { companyId: user.companyId };
  }

  const visitors = await prisma.visitor.findMany({
    where: visitorWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      email: true,
      vehicleNumber: true,
      accessory: true,
      validFrom: true,
      validUntil: true,
      createdAt: true,
    },
  });

  const visitorRows = visitors.map((visitor) => ({
    id: visitor.id,
    dateTime: formatVisitorTime(visitor.createdAt),
    name: visitor.name,
    phoneNumber: visitor.phoneNumber,
    email: visitor.email,
    vehicleNumber: visitor.vehicleNumber || "",
    accessory: visitor.accessory,
    validFrom: formatVisitorTime(visitor.validFrom),
    validUntil: formatVisitorTime(visitor.validUntil),
    validFromIso: visitor.validFrom.toISOString(),
    validUntilIso: visitor.validUntil.toISOString(),
  }));

  return <main className="dashboard-page">
    <Sidebar role={user.role} permissions={permissions} />
    <section className="dashboard-main">
      <header className="topbar">
        <div>
          <div className="section-kicker">{roleLabel(user.role).toUpperCase()}</div>
          <h1>Visitor Form</h1>
        </div>
        <div className="topbar-right">
          <div className="summary-card"><span>{scopeLabel}</span><strong>{scopeName}</strong></div>
          <SignOutButton />
        </div>
      </header>

      <section className="portfolio-card building-management visitor-form-card">
        <div className="portfolio-header visitor-form-heading">
          <div>
            <div className="section-kicker">VISITOR ACCESS</div>
          </div>
        </div>
        <div className="portfolio-divider" />
        <VisitorForm />
      </section>

      <section className="portfolio-card building-management visitor-list-card">
        <VisitorTable visitors={visitorRows} />
      </section>

      <style>{`
        .visitor-form-card{padding-top:15px;padding-bottom:15px}
        .visitor-form-card .portfolio-divider{margin:10px 0 12px}
        .visitor-list-card{padding-top:15px}
        @media(max-width:760px){
          .visitor-form-card,.visitor-list-card{padding:13px}
        }
      `}</style>
    </section>
  </main>;
}
