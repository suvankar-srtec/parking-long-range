import { scanEventType } from "@/lib/rfid-display";
import { dailyMovements } from "@/lib/rfid-movement-totals";
import { hasPermission as canUsePermission } from "@/lib/permissions";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Sign in required." }, { status: 401 });

  const url = new URL(request.url);
  if (user.role === "BUILDING_ADMIN" && !canUsePermission(user, "building.liveMonitor")) return NextResponse.json({ ok: false, message: "Live monitoring is not allowed for this account." }, { status: 403 });
  const start = parseDate(url.searchParams.get("start"));
  const end = parseDate(url.searchParams.get("end"));
  const requestedBuildingId = String(url.searchParams.get("buildingId") || "").trim();
  const requestedCompanyId = String(url.searchParams.get("companyId") || "").trim();
  if (!start || !end || start >= end) return NextResponse.json({ ok: false, message: "A valid local-day range is required." }, { status: 400 });

  let buildingId: string | null = null;
  let companyId: string | null = null;

  if (user.role === "EMPLOYEE" || user.role === "BUILDING_ADMIN") {
    buildingId = user.buildingId;
  } else if (user.role === "COMPANY_ADMIN" || user.role === "BUILDING_OWNER") {
    buildingId = user.buildingId;
    companyId = user.companyId;
  } else if (user.role === "SUPER_ADMIN") {
    if (!requestedBuildingId) return NextResponse.json({ ok: false, message: "Select a building to view realtime monitoring." }, { status: 400 });
    const building = await prisma.building.findUnique({ where: { id: requestedBuildingId }, select: { id: true, superAdminId: true } });
    if (!building) return NextResponse.json({ ok: false, message: "Building not found." }, { status: 404 });
    if (!isPrimarySuperAdmin(user) && building.superAdminId !== user.id) return NextResponse.json({ ok: false, message: "This building is outside your scope." }, { status: 403 });
    buildingId = building.id;
    companyId = requestedCompanyId || null;
  } else {
    return NextResponse.json({ ok: false, message: "Realtime monitor access is not available for this account." }, { status: 403 });
  }

  if (!buildingId) return NextResponse.json({ ok: false, message: "No building is assigned to this account." }, { status: 403 });
  if (companyId) {
    const company = await prisma.company.findFirst({ where: { id: companyId, buildingId }, select: { id: true } });
    if (!company) return NextResponse.json({ ok: false, message: "Company does not belong to the selected building." }, { status: 400 });
  }

  const supervisor = user.role === "EMPLOYEE";
  const allowTotalOnSite = !supervisor || hasPermission(user, "supervisor.totalOnSite");
  const allowTotalIn = !supervisor || hasPermission(user, "supervisor.totalIn");
  const allowTotalOut = !supervisor || hasPermission(user, "supervisor.totalOut");
  const allowActivity = !supervisor || (hasPermission(user, "supervisor.liveDashboard") && hasPermission(user, "supervisor.activity"));
  const allowEmployeeParking = !supervisor || hasPermission(user, "supervisor.employeeParking");
  if (supervisor && !allowTotalOnSite && !allowTotalIn && !allowTotalOut && !allowActivity && !allowEmployeeParking) {
    return NextResponse.json({ ok: false, message: "No realtime monitoring features are assigned to this Supervisor." }, { status: 403 });
  }

  const companyFilter = companyId ? { companyId } : {};
  const vehicleCompanyFilter = companyId ? { id: companyId } : { buildingId };
  const [building, company, movements, insideVehicles, ownerVehiclesInside, insideVisitors, recentEvents, parkingCompanies] = await Promise.all([
    prisma.building.findUnique({ where: { id: buildingId }, select: { name: true } }),
    companyId ? prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }) : Promise.resolve(null),
    dailyMovements(buildingId, companyId, start, end),
    prisma.vehicle.findMany({
      where: { isInside: true, company: vehicleCompanyFilter },
      select: {
        id: true,
        plateNumber: true,
        ownerName: true,
        department: true,
        rfidCardNo: true,
        lastAccessAt: true,
        employee: { select: { category: true } },
        company: { select: { name: true } },
      },
    }),
    companyId ? Promise.resolve([]) : prisma.buildingOwnerVehicle.findMany({
      where: { buildingId, isInside: true },
      select: { id: true, plateNumber: true, ownerName: true, rfidCardNo: true, lastAccessAt: true },
    }),
    prisma.visitor.findMany({
      where: { buildingId, ...(companyId ? { companyId } : {}), isInside: true },
      select: {
        id: true,
        name: true,
        vehicleNumber: true,
        accessory: true,
        lastAccessAt: true,
        company: { select: { name: true } },
      },
    }),
    prisma.rfidEvent.findMany({
      where: { buildingId, ...companyFilter, action: { in: ["ENTRY", "EXIT", "IGNORED", "DENIED", "DUPLICATE"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5000,
      select: {
        id: true,
        action: true,
        code: true,
        message: true,
        cardNo: true,
        vehicleId: true,
        ownerVehicleId: true,
        visitorId: true,
        deviceNumber: true,
        createdAt: true,
        vehicle: {
          select: {
            plateNumber: true,
            ownerName: true,
            department: true,
            employee: { select: { category: true } },
          },
        },
        ownerVehicle: { select: { plateNumber: true, ownerName: true } },
        visitor: { select: { name: true, vehicleNumber: true, accessory: true } },
        company: { select: { name: true } },
      },
    }),
    prisma.company.findMany({
      where: companyId ? { id: companyId, buildingId } : { buildingId }, orderBy: { name: "asc" },
      select: { id: true, name: true, employees: { where: { category: "EMPLOYEE" }, select: { parkingLimit: true } }, vehicles: { where: { isInside: true, employee: { category: "EMPLOYEE" } }, select: { id: true } } },
    }),
  ]);

  const departmentMap = new Map<string, number>();
  for (const vehicle of insideVehicles) {
    const department = vehicle.department?.trim() || "Unassigned";
    departmentMap.set(department, (departmentMap.get(department) || 0) + 1);
  }
  const departments = Array.from(departmentMap, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const activeCards = [
    ...insideVehicles.map((vehicle) => ({
      id: `vehicle:${vehicle.id}`,
      rfidCardNo: vehicle.rfidCardNo || "-",
      vehicleNumber: vehicle.plateNumber,
      personName: vehicle.ownerName,
      personType: vehicle.employee.category === "OWNER" ? "OWNER" : "EMPLOYEE",
      companyName: vehicle.company.name,
      department: vehicle.department || "-",
      entryTime: vehicle.lastAccessAt?.toISOString() || null,
    })),
    ...ownerVehiclesInside.map((vehicle) => ({
      id: `owner:${vehicle.id}`,
      rfidCardNo: vehicle.rfidCardNo || "-",
      vehicleNumber: vehicle.plateNumber,
      personName: vehicle.ownerName,
      personType: "OWNER",
      companyName: "Building owner",
      department: "-",
      entryTime: vehicle.lastAccessAt?.toISOString() || null,
    })),
    ...insideVisitors.map((visitor) => ({
      id: `visitor:${visitor.id}`,
      rfidCardNo: "VISITOR QR",
      vehicleNumber: visitor.vehicleNumber || "-",
      personName: visitor.name,
      personType: "VISITOR",
      companyName: visitor.company?.name || "Building visitor",
      department: visitor.accessory || "-",
      entryTime: visitor.lastAccessAt?.toISOString() || null,
    })),
  ].sort((a, b) => {
    const at = a.entryTime ? new Date(a.entryTime).getTime() : 0;
    const bt = b.entryTime ? new Date(b.entryTime).getTime() : 0;
    return bt - at;
  });

  const employeeParkingByCompany = parkingCompanies.map((parkingCompany) => ({ companyId: parkingCompany.id, companyName: parkingCompany.name, spacesAllotted: parkingCompany.employees.reduce((sum, employee) => sum + employee.parkingLimit, 0), vehiclesInside: parkingCompany.vehicles.length }));
  const employeeSpacesAllotted = employeeParkingByCompany.reduce((sum, item) => sum + item.spacesAllotted, 0);
  const employeeVehiclesInside = employeeParkingByCompany.reduce((sum, item) => sum + item.vehiclesInside, 0);
  const normalizedRecentEvents = recentEvents.map(({ ownerVehicle, visitor, ...event }) => {
    const personType = visitor
      ? "VISITOR"
      : ownerVehicle
        ? "OWNER"
        : event.vehicle?.employee.category === "OWNER"
          ? "OWNER"
          : event.vehicle
            ? "EMPLOYEE"
            : "UNKNOWN";

    const vehicle = visitor
      ? {
          plateNumber: visitor.vehicleNumber || "-",
          ownerName: visitor.name,
          department: visitor.accessory || "-",
        }
      : event.vehicle
        ? {
            plateNumber: event.vehicle.plateNumber,
            ownerName: event.vehicle.ownerName,
            department: event.vehicle.department,
          }
        : ownerVehicle
          ? {
              plateNumber: ownerVehicle.plateNumber,
              ownerName: ownerVehicle.ownerName,
              department: "-",
            }
          : null;

    return {
      ...event,
      entityKey: event.vehicleId ? `vehicle:${event.vehicleId}` : event.ownerVehicleId ? `owner:${event.ownerVehicleId}` : event.visitorId ? `visitor:${event.visitorId}` : undefined,
      eventType: scanEventType(event),
      cardNo: visitor ? "VISITOR QR" : event.cardNo,
      vehicle,
      personType,
      company: event.company || (visitor ? { name: "Building visitor" } : ownerVehicle ? { name: "Building owner" } : null),
    };
  });

  return NextResponse.json({
    ok: true,
    buildingName: building?.name || "Assigned building",
    companyName: company?.name || null,
    openingOnSite: allowTotalOnSite ? movements.openingOnSite : null,
    totalIn: allowTotalIn ? movements.totalIn : null,
    totalOut: allowTotalOut ? movements.totalOut : null,
    totalOnSite: allowTotalOnSite ? insideVehicles.length + ownerVehiclesInside.length + insideVisitors.length : null,
    canManualExit: user.role === "SUPER_ADMIN" || user.role === "BUILDING_ADMIN" && hasPermission(user, "building.approveManualExit") || user.role === "EMPLOYEE" && hasPermission(user, "supervisor.liveDashboard") && hasPermission(user, "supervisor.requestManualExit"),
    activeCards: allowTotalOnSite ? activeCards : [],
    employeeSpacesAllotted: allowEmployeeParking ? employeeSpacesAllotted : null,
    employeeVehiclesInside: allowEmployeeParking ? employeeVehiclesInside : null,
    employeeParkingByCompany: allowEmployeeParking ? employeeParkingByCompany : [],
    departments: allowTotalOnSite ? departments : [],
    recentEvents: allowActivity ? normalizedRecentEvents : [],
    updatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
