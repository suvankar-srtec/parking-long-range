import { withAuditRequest } from "@/lib/audit-request";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission, sanitizePermissions } from "@/lib/permissions";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";
import { MAX_PARKING } from "@/lib/parking";
import { claimUserId, UserIdError } from "@/lib/user-id-reservations";

async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: buildingId } = await context.params;
    const user = await getCurrentUser();
    const authorized = user && (user.role === "SUPER_ADMIN" || (user.role === "BUILDING_ADMIN" && user.buildingId === buildingId && hasPermission(user, "building.createCompanies")));
    if (!authorized || !user) {
      return NextResponse.json({ ok: false, message: "You do not have permission to create companies in this building." }, { status: 403 });
    }

    if (user.role === "SUPER_ADMIN" && !isPrimarySuperAdmin(user)) {
      const building = await prisma.building.findUnique({ where: { id: buildingId }, select: { superAdminId: true } });
      if (!building || building.superAdminId !== user.id) {
        return NextResponse.json({ ok: false, message: "This building is outside your scope." }, { status: 403 });
      }
    }

    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 }); }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, message: "Company details are required." }, { status: 400 });
    }

    const name = String(body.name ?? "").trim();
    const userId = String(body.userId ?? "").trim();
    const reservationId = String(body.reservationId ?? "");
    const username = name;
    const password = String(body.password ?? "");
    const parkingAllocation = Number(body.parkingAllocation ?? 0);
    const maximumDepartments = Number(body.maximumDepartments ?? 1);
    const permissions = sanitizePermissions("COMPANY_ADMIN", body.permissions);
    if (!name || !userId || !reservationId || !password.trim()) {
      return NextResponse.json({ ok: false, message: "Company name, generated User ID, and password are required." }, { status: 400 });
    }
    if (!Number.isInteger(parkingAllocation) || parkingAllocation < 0 || parkingAllocation > MAX_PARKING) {
      return NextResponse.json({ ok: false, message: "Parking allocation must be a valid whole number of 0 or greater." }, { status: 400 });
    }
    if (user.role === "BUILDING_ADMIN" && parkingAllocation > 0 && !hasPermission(user, "building.allocateCompanyParking")) {
      return NextResponse.json({ ok: false, message: "Your account cannot allocate company parking." }, { status: 403 });
    }
    if (!Number.isInteger(maximumDepartments) || maximumDepartments < 1 || maximumDepartments > 500) {
      return NextResponse.json({ ok: false, message: "Department limit must be between 1 and 500." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const building = await lockBuildingParking(tx, buildingId);
      const allocated = await tx.company.aggregate({ where: { buildingId }, _sum: { parkingAllocation: true } });
      const available = building.companyParking - (allocated._sum.parkingAllocation ?? 0);
      if (parkingAllocation > available) {
        throw new ParkingError(`Only ${available} company parking spaces are available.`);
      }
      if (await tx.company.findFirst({ where: { buildingId, name }, select: { id: true } })) {
        throw new ParkingError("This company already exists in the building.", 409);
      }

      const company = await tx.company.create({
        data: {
          name,
          parkingAllocation,
          ownerParkingAllocation: 0,
          visitorParkingAllocation: 0,
          employeeParkingAllocation: parkingAllocation,
          maximumDepartments,
          buildingId,
        },
      });

      await tx.companyDepartment.createMany({
        data: ["DEFAULT", "OPERATIONS", "ADMINISTRATION"].map((departmentName) => ({
          companyId: company.id,
          name: departmentName,
        })),
        skipDuplicates: true,
      });

      const claimedUserId = await claimUserId(tx, { ownerId: user.id, reservationId, kind: "company", scopeId: buildingId, name });
      if (claimedUserId !== userId) throw new ParkingError("The generated User ID changed. Refresh the form and try again.", 409);
      const account = await tx.user.create({
        data: {
          userId: claimedUserId,
          username,
          password,
          role: "COMPANY_ADMIN",
          buildingId,
          companyId: company.id,
          permissions,
          permissionsCustomized: true,
        },
      });
      await tx.entityIdentity.create({ data: { entityType: "company", entityId: company.id, userId: claimedUserId } });
      return { company, account };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 });

    revalidatePath("/account");
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/buildings/${buildingId}`);
    return NextResponse.json({
      ok: true,
      message: "Company created successfully.",
      company: { id: result.company.id, name: result.company.name, userId: result.account.userId, username: result.account.username },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ParkingError || error instanceof UserIdError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ ok: false, message: "Company name or User ID is already in use." }, { status: 409 });
    }
    console.error("CREATE_COMPANY_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to create company." }, { status: 500 });
  }
}

export const POST = withAuditRequest(handlePOST);
