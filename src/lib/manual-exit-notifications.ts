import { hasPermission } from "./permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { ParkingError } from "@/lib/building-parking";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
export async function notificationContext() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) throw new ParkingError("Notifications are available to Admin and Super Admin only.", 403);
  if (user.role === "BUILDING_ADMIN" && !hasPermission(user, "building.approveManualExit")) throw new ParkingError("Manual exit approval is not allowed for this account.", 403);
  if (user.role === "SUPER_ADMIN" && isPrimarySuperAdmin(user)) return { user, where: {} };
  const buildings = await prisma.building.findMany({ where: user.role === "BUILDING_ADMIN"
    ? { id: user.buildingId || "__none__" } : { superAdminId: user.id }, select: { id: true } });
  return { user, where: { buildingId: { in: buildings.map(building => building.id) } } };
}
