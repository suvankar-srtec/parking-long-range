import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import CloudCOfflineSettings from "@/components/CloudCOfflineSettings";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { effectivePermissions } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

export default async function OfflineSyncPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") redirect("/dashboard");
  const primary = isPrimarySuperAdmin(user);
  const readers = await prisma.rfidReader.findMany({
    where: { readerProtocol: "CLOUD_C", ...(primary ? {} : { building: { superAdminId: user.id } }) },
    select: { deviceNumber: true },
    orderBy: { deviceNumber: "asc" },
  });
  const controllers = [...new Set(readers
    .filter(reader => /-[AB]$/.test(reader.deviceNumber))
    .map(reader => reader.deviceNumber.slice(0, -2)))];

  return <main className="dashboard-page">
    <Sidebar role={user.role} permissions={effectivePermissions(user)} canCreateSuperAdmins={primary} />
    <section className="dashboard-main">
      <header className="topbar">
        <div><div className="section-kicker">ACCESS CONTROL</div><h1>Offline Sync</h1></div>
        <SignOutButton />
      </header>
      <div style={{ display: "grid", gap: 18, marginTop: 19 }}>
        {controllers.map(serial => <CloudCOfflineSettings key={serial} serial={serial} />)}
        {!controllers.length && <section className="portfolio-card"><p>No Cloud C controllers are available. Connect a controller to view its offline memory information.</p></section>}
      </div>
    </section>
  </main>;
}
