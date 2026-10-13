import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import GateDetailsManager from "@/components/GateDetailsManager";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { effectivePermissions, hasPermission } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import { parseGateConfig } from "@/lib/gate-config";

export default async function GateDetailsPage() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) redirect("/dashboard");
  if (user.role === "BUILDING_ADMIN" && !hasPermission(user, "building.configureGates")) redirect("/dashboard");

  const permissions = effectivePermissions(user);
  const primary = user.role === "SUPER_ADMIN" && isPrimarySuperAdmin(user);
  const where = user.role === "SUPER_ADMIN" ? (primary ? undefined : { superAdminId: user.id }) : { id: user.buildingId || "__none__" };

  const buildings = await prisma.building.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      maximumGate: true,
      gates: { select: { gateNumber: true, direction: true }, orderBy: { gateNumber: "asc" } },
      readers: { orderBy: { deviceNumber: "asc" }, select: { id: true, name: true, deviceNumber: true, mode: true, enabled: true } },
    },
  });

  const gateRows = buildings.map((building) => ({
    id: building.id,
    name: building.name,
    maximumGate: building.maximumGate,
    readers: building.readers,
    gates: building.gates.length ? building.gates.map((gate) => {
      const config = parseGateConfig(gate.direction);
      return { gateNumber: gate.gateNumber, direction: config.direction, entryReaderId: config.entryReaderId, exitReaderId: config.exitReaderId };
    }) : [{ gateNumber: 1, direction: "SELECT" as const, entryReaderId: null, exitReaderId: null }],
  }));

  return <main className="dashboard-page">
    <Sidebar role={user.role} permissions={permissions} canCreateSuperAdmins={primary} />
    <section className="dashboard-main">
      <header className="topbar"><div><div className="section-kicker">ACCESS CONTROL</div><h1>Gate Details</h1></div><SignOutButton /></header>
      <section className="portfolio-card building-management" style={{ marginTop: 19 }}>
        <GateDetailsManager buildings={gateRows} />
        <style>{`
          .dual-reader-selects{grid-template-columns:minmax(0,1fr)!important;gap:8px!important;max-width:360px}.dual-reader-selects label{grid-template-columns:48px minmax(0,1fr)!important;align-items:center!important;gap:8px!important}.dual-reader-selects label:first-child>span{color:#16845e!important}.dual-reader-selects label:last-child>span{color:#c53e3e!important}.dual-reader-selects label:first-child select{border-color:#b9ddce!important}.dual-reader-selects label:last-child select{border-color:#edc7c7!important}.dual-reader-selects label:first-child select:focus{border-color:#16845e!important;box-shadow:0 0 0 2px rgba(22,132,94,.10)!important}.dual-reader-selects label:last-child select:focus{border-color:#c53e3e!important;box-shadow:0 0 0 2px rgba(197,62,62,.10)!important}
        `}</style>
      </section>
    </section>
  </main>;
}
