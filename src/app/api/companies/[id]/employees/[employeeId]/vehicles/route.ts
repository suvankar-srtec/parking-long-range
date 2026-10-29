import { withAuditRequest } from "@/lib/audit-request";
import { companyCardScope } from "@/lib/company-card-access";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";
import { consumeCardEnrollment, lockRfid, RFID_TRANSACTION } from "@/lib/rfid-access";

const vehicleTypes = ["Two wheeler", "Four wheeler"];

async function handlePOST(request: Request, context: { params: Promise<{ id: string; employeeId: string }> }) {
  try {
    const { id: companyId, employeeId } = await context.params;
    const user = await getCurrentUser();
    const adminRegistration = user?.role === "SUPER_ADMIN" || (user?.role === "BUILDING_ADMIN" && hasPermission(user, "building.registerCompanyCards"));
    if (!user || (!adminRegistration && (user.role !== "COMPANY_ADMIN" || user.companyId !== companyId || !hasPermission(user, "company.manageVehicles")))) {
      return NextResponse.json({ ok: false, message: "Vehicle management is not assigned to this Company/User account." }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const ownerName = String(body?.ownerName ?? "").trim();
    const plateNumber = String(body?.plateNumber ?? "").trim().toUpperCase();
    const vehicleType = String(body?.vehicleType ?? "").trim();
    const department = String(body?.department ?? "").trim();
    const enrollmentId = String(body?.enrollmentId ?? "").trim();
    if (adminRegistration && !enrollmentId) throw new ParkingError("Scan a card using a registration reader before saving.");
    if (!adminRegistration && enrollmentId && !hasPermission(user, "company.registerRfid")) throw new ParkingError("RFID registration is not assigned to this Company/User account.", 403);
    if (body?.rfidCardNo) throw new ParkingError("Scan the card using a registration reader before saving.");
    const workerType = String(body?.workerType ?? "").trim();
    const isStaff = workerType === "Staff";
    if (!ownerName || !plateNumber || !vehicleTypes.includes(vehicleType) || !["Staff", "Employee"].includes(workerType) || !department) {
      return NextResponse.json({ ok: false, message: "Complete all vehicle registration fields." }, { status: 400 });
    }
    const result = await prisma.$transaction(async (tx) => {
      await lockRfid(tx);
      const employee = await tx.employee.findFirst({ where: { id: employeeId, companyId, ...(adminRegistration ? { company: companyCardScope(user) } : {}) }, select: { id: true, parkingLimit: true, isPlaceholder: true } });
      if (!employee) throw new ParkingError("Employee or company owner was not found in this company.", 404);
      if (employee.isPlaceholder) throw new ParkingError("Complete this employee roster slot before registering a vehicle.");
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { buildingId: true, enabled: true },
      });
      if (!company) throw new ParkingError("Company was not found.", 404);
      if (!company.enabled) throw new ParkingError("Enable this company before registering vehicles.", 409);
      const companyDepartment = await tx.companyDepartment.findFirst({
        where: {
          companyId,
          name: department,
          NOT: { name: { startsWith: "__ARCHIVED__" } },
        },
        select: { id: true },
      });
      if (!companyDepartment) throw new ParkingError("Select a valid department for this company.", 400);
      await lockBuildingParking(tx, company.buildingId);
      const employeeUsed = await tx.vehicle.count({ where: { employeeId } });
      if (employeeUsed >= Math.min(employee.parkingLimit, 1)) throw new ParkingError("Only one parking space is allowed per employee or company owner.", 400);
      const enrollment = enrollmentId ? await consumeCardEnrollment(tx, { enrollmentId, ownerId: user.id, companyId, employeeId, buildingId: company.buildingId }) : null;
      const vehicle = await tx.vehicle.create({ data: { ownerName, plateNumber, vehicleType, isStaff, department, rfidCardNo: enrollment?.cardNo || null, companyId, employeeId } });
      if (enrollment) await tx.rfidEvent.create({ data: { readerId: enrollment.readerId, buildingId: company.buildingId, companyId, vehicleId: vehicle.id, deviceNumber: enrollment.reader.deviceNumber, cardNo: enrollment.cardNo!, action: "REGISTER", code: "0000", message: "Card registered to vehicle." } });
      return { vehicle };
    }, RFID_TRANSACTION);
    revalidatePath("/dashboard");
    revalidatePath("/access-control/register-cards", "layout");
    return NextResponse.json({ ok: true, message: "Vehicle and RFID card registered successfully.", vehicle: result.vehicle }, { status: 201 });
  } catch (error) {
    if (error instanceof ParkingError) return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ ok: false, message: "This plate number or RFID card is already registered." }, { status: 409 });
    console.error("CREATE_VEHICLE_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to register vehicle." }, { status: 500 });
  }
}

export const POST = withAuditRequest(handlePOST);
