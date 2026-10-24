export type EntityKind = "building" | "company" | "employee" | "supervisor";

export function normalizeEntityName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function userIdCode(kind: EntityKind) {
  if (kind === "building") return "BLD";
  if (kind === "company") return "COMP";
  if (kind === "supervisor") return "SUP";
  return "EMP";
}

export function canCreateEntity(
  user: { role: string; buildingId: string | null; companyId: string | null } | null,
  kind: EntityKind,
  scopeId: string,
) {
  if (!user) return false;
  if (kind === "building") return user.role === "SUPER_ADMIN" && scopeId === "";
  if (kind === "company") return !!scopeId && (user.role === "SUPER_ADMIN" || user.role === "BUILDING_ADMIN" && user.buildingId === scopeId);
  if (kind === "supervisor") {
    if (!scopeId) return false;
    if (user.role === "SUPER_ADMIN") return true;
    return user.role === "BUILDING_ADMIN" && user.buildingId === scopeId;
  }
  return ["COMPANY_ADMIN", "BUILDING_OWNER"].includes(user.role) && !!scopeId && user.companyId === scopeId;
}
