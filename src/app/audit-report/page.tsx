import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import AuditReport from "@/components/AuditReport";
import { getCurrentUser } from "@/lib/session";
import { effectivePermissions } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
export default async function AuditReportPage() {
 const user=await getCurrentUser(); if(!user) redirect("/");
 if(user.role!=="SUPER_ADMIN") redirect("/dashboard");
 return <main className="dashboard-page"><Sidebar role={user.role} permissions={effectivePermissions(user)} canCreateSuperAdmins={isPrimarySuperAdmin(user)} />
 <section className="dashboard-main"><header className="topbar"><div><h1>Audit Report</h1></div><div className="topbar-right"><SignOutButton /></div></header><AuditReport /></section></main>;
}
