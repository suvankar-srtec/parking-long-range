import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

async function handlePATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getCurrentUser();
    const companyScopedRole = user?.role === "COMPANY_ADMIN" || user?.role === "BUILDING_OWNER";
    if (!user || !companyScopedRole || user.companyId !== id || !hasPermission(user, "company.allocateEmployeeParking")) {
      return NextResponse.json({ ok: false, message: "Parking split management is not assigned to this Company/User account." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const ownerParkingAllocation = Number(body?.ownerParkingAllocation);
    const visitorParkingAllocation = Number(body?.visitorParkingAllocation ?? 0);
    const employeeParkingAllocation = Number(body?.employeeParkingAllocation);
    if (
      !Number.isInteger(ownerParkingAllocation) || ownerParkingAllocation < 0
      || !Number.isInteger(visitorParkingAllocation) || visitorParkingAllocation < 0
      || !Number.isInteger(employeeParkingAllocation) || employeeParkingAllocation < 0
    ) {
      return NextResponse.json({ ok: false, message: "Owner, Visitor and Employee parking must be whole numbers of 0 or greater." }, { status: 400 });
    }

    const company = await prisma.company.findUnique({
      where: { id },
      select: {
        parkingAllocation: true,
        vehicles: { where: { isInside: true }, select: { employee: { select: { category: true } } } },
      },
    });
    if (!company) return NextResponse.json({ ok: false, message: "Company not found." }, { status: 404 });
    if (ownerParkingAllocation + visitorParkingAllocation + employeeParkingAllocation !== company.parkingAllocation) {
      return NextResponse.json({
        ok: false,
        message: `Company Owner parking + Visitor parking + Employee parking must equal the company parking allocation of ${company.parkingAllocation}.`,
      }, { status: 400 });
    }

    const currentOwners = company.vehicles.filter((vehicle) => vehicle.employee?.category === "OWNER").length;
    const currentEmployees = company.vehicles.filter((vehicle) => vehicle.employee?.category !== "OWNER").length;
    if (ownerParkingAllocation < currentOwners) {
      return NextResponse.json({ ok: false, message: `${currentOwners} Company Owner vehicles are currently inside. Company Owner parking cannot be lower than ${currentOwners} until a vehicle exits.` }, { status: 400 });
    }
    if (employeeParkingAllocation < currentEmployees) {
      return NextResponse.json({ ok: false, message: `${currentEmployees} Employee vehicles are currently inside. Employee parking cannot be lower than ${currentEmployees} until a vehicle exits.` }, { status: 400 });
    }

    const updated = await prisma.company.update({
      where: { id },
      data: { ownerParkingAllocation, visitorParkingAllocation, employeeParkingAllocation },
      select: {
        id: true,
        parkingAllocation: true,
        ownerParkingAllocation: true,
        visitorParkingAllocation: true,
        employeeParkingAllocation: true,
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/company-parking");
    return NextResponse.json({ ok: true, message: "Company parking split updated successfully.", company: updated });
  } catch (error) {
    console.error("UPDATE_COMPANY_PARKING_SPLIT_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to update company parking split." }, { status: 500 });
  }
}

export const PATCH = withAuditRequest(handlePATCH);
