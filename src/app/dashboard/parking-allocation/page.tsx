import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import BuildingParkingEditor from "@/components/BuildingParkingEditor";
import BuildingAccessPolicyEditor from "@/components/BuildingAccessPolicyEditor";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { effectivePermissions, hasPermission } from "@/lib/permissions";

export default async function AdminParkingAllocationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (user.role !== "BUILDING_ADMIN" || !user.buildingId) redirect("/dashboard");
  if (!hasPermission(user, "building.allocateCompanyParking") || !hasPermission(user, "building.manageOwnerParking")) redirect("/dashboard");

  const permissions = effectivePermissions(user);
  const [building, allocation] = await Promise.all([
    prisma.building.findUnique({
      where: { id: user.buildingId },
      select: {
        id: true,
        name: true,
        totalParking: true,
        ownerParking: true,
        visitorParking: true,
        companyParking: true,
        maximumGate: true,
        parkingLimitsEnabled: true,
        antiPassbackEnabled: true,
      },
    }),
    prisma.company.aggregate({
      where: { buildingId: user.buildingId },
      _sum: { parkingAllocation: true },
    }),
  ]);

  if (!building) redirect("/dashboard");
  const companyAllotted = allocation._sum.parkingAllocation ?? 0;
  const companyAvailable = Math.max(building.companyParking - companyAllotted, 0);

  return <main className="dashboard-page">
    <Sidebar role={user.role} permissions={permissions} />
    <section className="dashboard-main">
      <header className="topbar">
        <div><div className="section-kicker">ADMIN</div><h1>Parking allocation</h1></div>
        <div className="topbar-right"><div className="summary-card"><span>Building</span><strong>{building.name}</strong></div><SignOutButton /></div>
      </header>

      <section className="portfolio-card building-management">
        <div className="portfolio-header">
          <div>
            <div className="section-kicker">BUILDING PARKING</div>
            <h2>Parking allocation</h2>
            <p className="parking-formula">Total parking = Owner + Visitor + Company</p>
          </div>
        </div>
        <div className="portfolio-divider" />
        <BuildingAccessPolicyEditor buildingId={building.id} parkingLimitsEnabled={building.parkingLimitsEnabled} antiPassbackEnabled={building.antiPassbackEnabled} />
        <BuildingParkingEditor
          buildingId={building.id}
          initialValues={{
            totalParking: building.totalParking,
            ownerParking: building.ownerParking,
            visitorParking: building.visitorParking,
            companyParking: building.companyParking,
            maximumGate: building.maximumGate,
          }}
          canEditMaximumGate
        />
        <div className="admin-parking-status">
          <div className="large-stat"><span>Company parking</span><strong>{building.companyParking}</strong></div>
          <div className="large-stat"><span>Already allotted</span><strong>{companyAllotted}</strong></div>
          <div className="large-stat"><span>Available</span><strong>{companyAvailable}</strong></div>
        </div>
      </section>
    </section>
    <style>{`
      .parking-formula{margin:5px 0 0;color:#52667d;font-size:13px;font-weight:700}.admin-parking-status{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:18px;padding-top:18px;border-top:1px solid #d9e1dd}
      @media(max-width:700px){.admin-parking-status{grid-template-columns:1fr}}
    `}</style>
  </main>;
}
