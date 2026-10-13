import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SignOutButton from "@/components/SignOutButton";
import CardBlockManager from "@/components/CardBlockManager";
import { prisma } from "@/lib/prisma";
import { effectivePermissions, hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

export default async function CardBlockPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "BUILDING_ADMIN" || !user.buildingId) redirect("/dashboard");
  if (!hasPermission(user, "building.blockCards")) redirect("/dashboard");

  const permissions = effectivePermissions(user);
  const [building, vehicles, ownerVehicles] = await Promise.all([
    prisma.building.findUnique({
      where: { id: user.buildingId },
      select: { name: true },
    }),
    prisma.vehicle.findMany({
      where: {
        isInside: true,
        rfidCardNo: { not: null },
        company: { buildingId: user.buildingId },
      },
      orderBy: [{ lastAccessAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        rfidCardNo: true,
        rfidBlocked: true,
        plateNumber: true,
        ownerName: true,
        lastAccessAt: true,
        company: { select: { name: true } },
        employee: { select: { category: true } },
      },
    }),
    prisma.buildingOwnerVehicle.findMany({
      where: {
        buildingId: user.buildingId,
        isInside: true,
        rfidCardNo: { not: null },
      },
      orderBy: [{ lastAccessAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        rfidCardNo: true,
        rfidBlocked: true,
        plateNumber: true,
        ownerName: true,
        lastAccessAt: true,
      },
    }),
  ]);

  const cards = [
    ...vehicles.map((vehicle) => ({
      id: vehicle.id,
      type: "company" as const,
      cardNo: vehicle.rfidCardNo || "-",
      vehicleNumber: vehicle.plateNumber || "-",
      personName: vehicle.ownerName || "-",
      personType: vehicle.employee.category === "OWNER" ? "Company Owner" : "Employee",
      companyName: vehicle.company.name,
      entryTime: vehicle.lastAccessAt?.toISOString() || null,
      blocked: vehicle.rfidBlocked,
    })),
    ...ownerVehicles.map((vehicle) => ({
      id: vehicle.id,
      type: "owner" as const,
      cardNo: vehicle.rfidCardNo || "-",
      vehicleNumber: vehicle.plateNumber || "-",
      personName: vehicle.ownerName || "-",
      personType: "Building Owner",
      companyName: "Building owner",
      entryTime: vehicle.lastAccessAt?.toISOString() || null,
      blocked: vehicle.rfidBlocked,
    })),
  ].sort((a, b) => new Date(b.entryTime || 0).getTime() - new Date(a.entryTime || 0).getTime());

  return <main className="dashboard-page">
    <Sidebar role={user.role} permissions={permissions} />
    <section className="dashboard-main">
      <header className="topbar">
        <div>
          <div className="section-kicker">ACCESS CONTROL</div>
          <h1>Card Block</h1>
        </div>
        <div className="topbar-right">
          <div className="summary-card"><span>Building</span><strong>{building?.name || "Assigned building"}</strong></div>
          <SignOutButton />
        </div>
      </header>

      <section className="portfolio-card building-management">
        <div className="portfolio-header">
          <div>
            <div className="section-kicker">ENTRY CARDS</div>
            <h2>Cards currently inside</h2>
            <p>Only RFID cards with a successful Entry are shown here. Blocking a card prevents it from being used for Exit until it is unblocked.</p>
          </div>
        </div>
        <div className="portfolio-divider" />
        <CardBlockManager cards={cards} />
      </section>
    </section>
  </main>;
}
