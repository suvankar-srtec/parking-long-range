import { redirect, notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import BuildingAccessPolicyEditor from "@/components/BuildingAccessPolicyEditor";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { effectivePermissions } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

export default async function BuildingAccessSettingsPage({ field, searchParams }: {
  field: "parkingLimitsEnabled" | "antiPassbackEnabled";
  searchParams: Promise<{ buildingId?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (user.role !== "SUPER_ADMIN" && user.role !== "BUILDING_ADMIN") redirect("/dashboard");
  if (user.role === "BUILDING_ADMIN" && !user.buildingId) redirect("/dashboard");
  const buildings = await prisma.building.findMany({
    where: user.role === "BUILDING_ADMIN" ? { id: user.buildingId! } : isPrimarySuperAdmin(user) ? {} : { superAdminId: user.id },
    select: { id: true, name: true, parkingLimitsEnabled: true, antiPassbackEnabled: true },
    orderBy: { name: "asc" },
  });
  const query = await searchParams;
  const building = query.buildingId ? buildings.find(item => item.id === query.buildingId) : buildings[0];
  if (query.buildingId && !building) notFound();
  const title = field === "parkingLimitsEnabled" ? "Limit enable/disable" : "Anti-passback";
  const path = field === "parkingLimitsEnabled" ? "/settings/limits" : "/settings/anti-passback";
  return <main className="dashboard-page">
    <Sidebar role={user.role} permissions={effectivePermissions(user)} canCreateSuperAdmins={isPrimarySuperAdmin(user)} />
    <section className="dashboard-main">
      <header className="topbar"><div><div className="section-kicker">SETTINGS</div><h1>{title}</h1></div><SignOutButton /></header>
      <section className="portfolio-card building-management">
        {building ? <>
          {user.role === "SUPER_ADMIN" ? <form action={path} className="access-building-selector">
            <label htmlFor="settings-building">Building</label>
            <select id="settings-building" name="buildingId" defaultValue={building.id}><>{buildings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</></select>
            <button type="submit" className="secondary-button">Open building</button>
          </form> : <h2>{building.name}</h2>}
          <BuildingAccessPolicyEditor key={building.id + field} buildingId={building.id} field={field} parkingLimitsEnabled={building.parkingLimitsEnabled} antiPassbackEnabled={building.antiPassbackEnabled} />
        </> : <p>No buildings are assigned to this account.</p>}
      </section>
    </section>
    <style>{`.access-building-selector{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}.access-building-selector label{font-size:12px;font-weight:700}.access-building-selector select{max-width:100%;min-width:160px;padding:7px;border:1px solid #b8cde3;border-radius:5px;font-size:12px}`}</style>
  </main>;
}
