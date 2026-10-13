import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import RealtimeMonitor from "@/components/RealtimeMonitor";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { effectivePermissions, hasPermission } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

export default async function RealtimeMonitorPage() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) redirect("/dashboard");
  if (user.role === "BUILDING_ADMIN" && !hasPermission(user, "building.liveMonitor")) redirect("/dashboard");

  const permissions = effectivePermissions(user);
  const primarySuperAdmin = user.role === "SUPER_ADMIN" && isPrimarySuperAdmin(user);
  const buildingWhere = user.role === "SUPER_ADMIN"
    ? (primarySuperAdmin ? undefined : { superAdminId: user.id })
    : user.buildingId ? { id: user.buildingId } : { id: "__no_scope__" };

  const buildings = await prisma.building.findMany({
    where: buildingWhere,
    orderBy: { name: "asc" },
    select: { id: true, name: true, companies: { orderBy: { name: "asc" }, select: { id: true, name: true, buildingId: true } } },
  });

  const companies = buildings.flatMap((building) => building.companies);
  const fixedBuildingId = user.role === "SUPER_ADMIN" ? null : user.buildingId;

  return <main className="dashboard-page">
    <Sidebar role={user.role} permissions={permissions} canCreateSuperAdmins={primarySuperAdmin} />
    <section className="dashboard-main">
      <header className="topbar"><div><div className="section-kicker">ACCESS CONTROL</div><h1>Real Time Monitor</h1></div><SignOutButton /></header>
      <RealtimeMonitor buildings={buildings.map(({ id, name }) => ({ id, name }))} companies={companies} fixedBuildingId={fixedBuildingId} fixedCompanyId={null} />
    </section>
  </main>;
}
