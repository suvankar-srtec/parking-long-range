import type { Prisma, User } from "@prisma/client";
import { hasPermission } from "./permissions";
import { isPrimarySuperAdmin } from "./super-admin-scope";

type CardUser = Pick<User, "id" | "userId" | "role" | "buildingId" | "companyId" | "permissions" | "permissionsCustomized">;

// Shared by the company list, employee view and registration endpoints.
export function companyCardScope(user: CardUser): Prisma.CompanyWhereInput {
  if (user.role === "SUPER_ADMIN") return isPrimarySuperAdmin(user)
    ? { enabled: true }
    : { enabled: true, building: { superAdminId: user.id } };
  if (user.role === "BUILDING_ADMIN" && user.buildingId && hasPermission(user, "building.registerCompanyCards")) {
    return { enabled: true, buildingId: user.buildingId };
  }
  if (user.role === "COMPANY_ADMIN" && user.companyId && hasPermission(user, "company.registerRfid")) {
    return { enabled: true, id: user.companyId };
  }
  return { id: { in: [] } };
}
