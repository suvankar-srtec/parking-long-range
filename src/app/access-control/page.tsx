import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { effectivePermissions, hasPermission } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import Sidebar from "@/components/Sidebar";
import ReaderConsole from "@/components/ReaderConsole";
import SignOutButton from "@/components/SignOutButton";

export default async function AccessControlPage() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) redirect("/dashboard");
  if (user.role === "BUILDING_ADMIN" && !hasPermission(user, "building.configureReaders")) redirect("/dashboard");

  const permissions = effectivePermissions(user);
  const primary = user.role === "SUPER_ADMIN" && isPrimarySuperAdmin(user);
  return <main className="dashboard-page">
    <Sidebar role={user.role} permissions={permissions} canCreateSuperAdmins={primary} />
    <section className="dashboard-main">
      <header className="topbar"><div><div className="section-kicker">BUILDING PARKING</div><h1>RFID access</h1></div><SignOutButton /></header>
      <div className="rfid-reader-console"><ReaderConsole /></div>

    </section>
  </main>;
}
