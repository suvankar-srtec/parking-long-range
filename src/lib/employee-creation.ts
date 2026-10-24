import type { UserRole } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";

export function canCreateCompanyPeople(user: {
  role: UserRole;
  buildingId: string | null;
  companyId: string | null;
  permissions?: string[];
  permissionsCustomized?: boolean;
}, company: { id: string; buildingId: string }) {
  if (user.role === "BUILDING_ADMIN") return user.buildingId === company.buildingId;
  return (user.role === "COMPANY_ADMIN" || user.role === "BUILDING_OWNER") &&
    user.companyId === company.id && hasPermission(user, "company.managePeople");
}
