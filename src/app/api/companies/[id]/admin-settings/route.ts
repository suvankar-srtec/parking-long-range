import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

async function handlePATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();
    const buildingAdminAllowed = user?.role === "BUILDING_ADMIN"
      && Boolean(user.buildingId)
      && hasPermission(user, "building.allocateCompanyParking");
    const superAdminAllowed = user?.role === "SUPER_ADMIN";

    if (!user || (!buildingAdminAllowed && !superAdminAllowed)) {
      return NextResponse.json({ ok: false, message: "You do not have permission to edit company capacity." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parkingAllocation = Number(body?.parkingAllocation);
    if (!Number.isInteger(parkingAllocation) || parkingAllocation < 0) return NextResponse.json({ ok: false, message: "Company parking must be a whole number of 0 or greater." }, { status: 400 });

    const updated = await prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id },
        select: {
          id: true,
          buildingId: true,
          parkingAllocation: true,
          ownerParkingAllocation: true,
          visitorParkingAllocation: true,
          employeeParkingAllocation: true,
          building: { select: { superAdminId: true } },
        },
      });
      if (!company) throw new ParkingError("Company not found.", 404);

      if (user.role === "BUILDING_ADMIN" && company.buildingId !== user.buildingId) {
        throw new ParkingError("Company not found in your building.", 404);
      }
      if (
        user.role === "SUPER_ADMIN"
        && !isPrimarySuperAdmin(user)
        && company.building.superAdminId !== user.id
      ) {
        throw new ParkingError("This company is outside your Super Admin scope.", 403);
      }

      if (parkingAllocation < company.parkingAllocation) {
        const vehiclesInside = await tx.vehicle.count({
          where: { companyId: company.id, isInside: true },
        });
        if (vehiclesInside > 0) {
          throw new ParkingError("Vehicle already in parking. Wait until exit.");
        }
      }

      const splitAssigned = company.ownerParkingAllocation + company.visitorParkingAllocation + company.employeeParkingAllocation;
      if (parkingAllocation < splitAssigned) throw new ParkingError(`${splitAssigned} parking spaces are already divided between Company Owners, Visitors and Employees. Company parking cannot be lower than ${splitAssigned}.`);

      const building = await lockBuildingParking(tx, company.buildingId);
      const others = await tx.company.aggregate({ where: { buildingId: company.buildingId, NOT: { id } }, _sum: { parkingAllocation: true } });
      const availableForThisCompany = building.companyParking - (others._sum.parkingAllocation ?? 0);
      if (parkingAllocation > availableForThisCompany) throw new ParkingError(`Only ${availableForThisCompany} parking spaces are available for this company.`);

      const result = await tx.company.update({
        where: { id },
        data: { parkingAllocation },
        select: { id: true, parkingAllocation: true, ownerParkingAllocation: true, visitorParkingAllocation: true, employeeParkingAllocation: true },
      });
      return result;
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/company-parking");
    return NextResponse.json({ ok: true, message: "Company parking allocation updated.", company: updated });
  } catch (error) {
    if (error instanceof ParkingError) return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    console.error("UPDATE_COMPANY_ADMIN_SETTINGS_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to update company capacity." }, { status: 500 });
  }
}

export const PATCH = withAuditRequest(handlePATCH);
