import type { UserRole } from "@prisma/client";

export const PERMISSION_KEYS = [
  "building.offlineSync",
  "building.manageCompanyAccounts",
  "supervisor.requestManualExit",
  "company.manageVisitors",
  "building.configureGates",
  "building.registerCompanyCards",
  "building.liveMonitor",
  "building.blockCards",
  "building.manageVisitors",
  "building.approveManualExit",
  "building.createCompanies",
  "building.allocateCompanyParking",
  "building.manageOwnerParking",
  "building.registerOwnerParking",
  "building.configureReaders",
  "building.manageSupervisor",
  "building.viewReports",
  "company.managePeople",
  "company.allocateEmployeeParking",
  "company.manageVehicles",
  "company.registerRfid",
  "company.viewUsage",
  "company.viewReports",
  "supervisor.totalOnSite",
  "supervisor.totalIn",
  "supervisor.totalOut",
  "supervisor.liveDashboard",
  "supervisor.activity",
  "supervisor.employeeParking",
  "supervisor.readerStatus",
  "supervisor.viewReports",
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];

export type PermissionOption = {
  key: PermissionKey;
  label: string;
  description: string;
};

const BUILDING_ADMIN_PERMISSIONS: PermissionOption[] = [
  { key: "building.offlineSync", label: "Offline Sync", description: "View uploaded controller records for this building." },
  { key: "building.manageCompanyAccounts", label: "Manage company accounts", description: "Enable or disable companies and update their account passwords." },
  { key: "building.configureGates", label: "Configure gates", description: "Assign entry and exit readers to building gates." },
  { key: "building.registerCompanyCards", label: "Register company cards", description: "Register RFID cards for company vehicles in this building." },
  { key: "building.liveMonitor", label: "Live entry / exit monitoring", description: "View building activity and vehicles currently on site." },
  { key: "building.blockCards", label: "Block / unblock RFID cards", description: "Control card access within this building." },
  { key: "building.manageVisitors", label: "Manage visitors and QR passes", description: "Create and edit building visitors, download and send QR passes." },
  { key: "building.approveManualExit", label: "Approve manual exit requests", description: "Review notifications and approve Supervisor requests; perform manual exits." },
  { key: "building.createCompanies", label: "Create companies", description: "Create companies inside this building only." },
  { key: "building.allocateCompanyParking", label: "Allocate company parking", description: "Set parking allocation while creating companies." },
  { key: "building.manageOwnerParking", label: "Manage Owner Parking", description: "View and remove Owner Parking allocations." },
  { key: "building.registerOwnerParking", label: "Register Owner Parking", description: "Add Owner Parking vehicles and register RFID cards." },
  { key: "building.configureReaders", label: "Add / configure readers", description: "Add and configure readers for this building only." },
  { key: "building.manageSupervisor", label: "Manage Supervisor", description: "Create or update the building Supervisor account." },
  { key: "building.viewReports", label: "Building reports", description: "View parking reports for this building." },
];

const COMPANY_PERMISSIONS: PermissionOption[] = [
  { key: "company.manageVisitors", label: "Manage visitors and QR passes", description: "Create and edit company visitors, download and send QR passes." },
  { key: "company.managePeople", label: "Manage people and departments", description: "Add and edit Employees, Company Owners and company departments." },
  { key: "company.allocateEmployeeParking", label: "Allocate employee parking", description: "Assign parking limits within the company allocation." },
  { key: "company.manageVehicles", label: "Add / remove vehicles", description: "Register and remove vehicles for company people." },
  { key: "company.registerRfid", label: "Register RFID cards", description: "Use a registration reader to assign RFID cards to vehicles." },
  { key: "company.viewUsage", label: "Company parking usage", description: "View company limits, assignments and registered vehicle usage." },
  { key: "company.viewReports", label: "Company reports", description: "View reports for this company only." },
];

const SUPERVISOR_PERMISSIONS: PermissionOption[] = [
  { key: "supervisor.requestManualExit", label: "Request manual exit", description: "Request an exit for an on-site vehicle; Admin or Super Admin approval is required." },
  { key: "supervisor.totalOnSite", label: "Total On Site", description: "See the current number of vehicles inside." },
  { key: "supervisor.totalIn", label: "Total IN", description: "See today's successful entry count." },
  { key: "supervisor.totalOut", label: "Total OUT", description: "See today's successful exit count." },
  { key: "supervisor.liveDashboard", label: "Live Dashboard", description: "Open the live RFID monitoring dashboard." },
  { key: "supervisor.activity", label: "ENTRY / EXIT / IGNORED activity", description: "See live and historical RFID activity rows." },
  { key: "supervisor.employeeParking", label: "Employee Parking Allocation", description: "See employee parking spaces allotted by companies and vehicles inside." },
  { key: "supervisor.readerStatus", label: "Allotted Reader status", description: "See readers allotted to the building and their status." },
  { key: "supervisor.viewReports", label: "Building reports", description: "View reports for the assigned building." },
];

export function permissionOptionsForRole(role: UserRole): PermissionOption[] {
  if (role === "BUILDING_ADMIN") return BUILDING_ADMIN_PERMISSIONS;
  if (role === "COMPANY_ADMIN" || role === "BUILDING_OWNER") return COMPANY_PERMISSIONS;
  if (role === "EMPLOYEE") return SUPERVISOR_PERMISSIONS;
  return [];
}

export function defaultPermissionsForRole(role: UserRole): PermissionKey[] {
  return permissionOptionsForRole(role).map((option) => option.key);
}

export function sanitizePermissions(role: UserRole, value: unknown): PermissionKey[] {
  const allowed = new Set(permissionOptionsForRole(role).map((option) => option.key));
  if (!Array.isArray(value)) return defaultPermissionsForRole(role);
  return Array.from(new Set(value.map(String).filter((item): item is PermissionKey => allowed.has(item as PermissionKey))));
}

type PermissionUser = {
  role: UserRole;
  permissions?: string[] | null;
  permissionsCustomized?: boolean | null;
};

export function effectivePermissions(user: PermissionUser): PermissionKey[] {
  if (user.role === "SUPER_ADMIN") return [...PERMISSION_KEYS];
  if (!user.permissionsCustomized) return defaultPermissionsForRole(user.role);
  return sanitizePermissions(user.role, user.permissions ?? []);
}

export function hasPermission(user: PermissionUser, permission: PermissionKey) {
  if (user.role === "SUPER_ADMIN") return true;
  return effectivePermissions(user).includes(permission);
}
