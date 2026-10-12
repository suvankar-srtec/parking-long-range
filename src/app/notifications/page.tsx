import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { effectivePermissions } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import ManualExitNotifications from "@/components/ManualExitNotifications";
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) redirect("/dashboard");
  return <main className="dashboard-page"><Sidebar role={user.role} permissions={effectivePermissions(user)} canCreateSuperAdmins={isPrimarySuperAdmin(user)} />
    <section className="dashboard-main"><header className="topbar"><div><div className="section-kicker">ACCESS CONTROL</div><h1>Notifications</h1></div><SignOutButton /></header><ManualExitNotifications /></section>
  </main>;
}
