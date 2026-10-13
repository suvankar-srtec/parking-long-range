import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import CloudCOfflineHistory from "@/components/CloudCOfflineHistory";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { effectivePermissions, hasPermission } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

export default async function OfflineSyncPage() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) redirect("/dashboard");
  if (user.role === "BUILDING_ADMIN" && (!user.buildingId || !hasPermission(user, "building.offlineSync"))) redirect("/dashboard");
  const primary = isPrimarySuperAdmin(user);
  const readers = await prisma.rfidReader.findMany({
    where: { readerProtocol: "CLOUD_C", ...(user.role === "BUILDING_ADMIN" ? { buildingId: user.buildingId! } : primary ? {} : { building: { superAdminId: user.id } }) },
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
        <CloudCOfflineHistory controllers={controllers} />
      </div>
    </section>
  </main>;
}
