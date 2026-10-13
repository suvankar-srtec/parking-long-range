import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";

const ARCHIVED_DEPARTMENT_PREFIX = "__ARCHIVED__";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const user = await getCurrentUser();

  if (!user || user.role !== "BUILDING_ADMIN" || !user.buildingId || !hasPermission(user, "building.manageCompanyAccounts")) {
    return NextResponse.json(
      { ok: false, message: "Only the Building Admin can change company status." },
      { status: 403 },
    );
  }

  const buildingId = user.buildingId;

  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ ok: false, message: "Choose Enable or Disable." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.findFirst({
        where: { id, buildingId },
        select: {
          id: true,
          name: true,
          enabled: true,
          buildingId: true,
          parkingAllocation: true,
          ownerParkingAllocation: true,
          employeeParkingAllocation: true,
        },
      });

      if (!company) throw new ParkingError("Company not found in your building.", 404);
      if (company.enabled === body.enabled) {
        return {
          companyName: company.name,
          enabled: company.enabled,
          released: 0,
          allocated: company.parkingAllocation,
        };
      }

      const building = await lockBuildingParking(tx, company.buildingId);

      if (!body.enabled) {
        const vehiclesInside = await tx.vehicle.count({
          where: { companyId: company.id, isInside: true },
        });
        if (vehiclesInside > 0) {
          throw new ParkingError("Vehicle already in parking. Wait until exit.");
        }

        const released = company.parkingAllocation;

        // Archive the current operating roster without deleting historical records.
        // Archived employees keep their name/User ID/department and vehicle history,
        // but are excluded from all active employee and RFID views.
        await tx.employee.updateMany({
          where: { companyId: company.id, isPlaceholder: false },
          data: {
            isPlaceholder: true,
            slotNumber: null,
            parkingLimit: 0,
          },
        });

        // Release assigned RFID cards so the physical cards can be registered again
        // to the new employee roster after the company is re-enabled.
        await tx.vehicle.updateMany({
          where: { companyId: company.id },
          data: { rfidCardNo: null },
        });

        await tx.rfidEnrollment.updateMany({
          where: {
            companyId: company.id,
            status: { in: ["WAITING", "CAPTURED"] },
          },
          data: { status: "CANCELLED" },
        });

        // Keep old department rows for history, but move them out of the active
        // namespace so the Admin starts with a fresh department list on re-enable.
        const departments = await tx.companyDepartment.findMany({
          where: {
            companyId: company.id,
            NOT: { name: { startsWith: ARCHIVED_DEPARTMENT_PREFIX } },
          },
          select: { id: true, name: true },
        });
        const archiveStamp = Date.now().toString(36);
        for (const department of departments) {
          const archivedName = `${ARCHIVED_DEPARTMENT_PREFIX}${archiveStamp}_${department.id.slice(-6)}_${department.name.slice(0, 40)}`;
          await tx.companyDepartment.update({
            where: { id: department.id },
            data: { name: archivedName },
          });
        }

        await tx.building.update({
          where: { id: company.buildingId },
          data: {
            ownerParking: { increment: released },
            companyParking: { decrement: released },
          },
        });

        await tx.company.update({
          where: { id: company.id },
          data: {
            enabled: false,
            parkingAllocation: 0,
            ownerParkingAllocation: 0,
            employeeParkingAllocation: 0,
          },
        });

        return {
          companyName: company.name,
          enabled: false,
          released,
          allocated: 0,
        };
      }

      const name = String(body?.name ?? "").trim();
      const parkingAllocation = Number(body?.parkingAllocation);

      if (!name) throw new ParkingError("Company name is required to enable this company.");
      if (!Number.isInteger(parkingAllocation) || parkingAllocation < 1) {
        throw new ParkingError("Enter a parking allocation of at least 1 space.");
      }

      const liveBuilding = await tx.building.findUnique({
        where: { id: company.buildingId },
        select: {
          ownerParking: true,
          ownerVehicles: { select: { id: true } },
        },
      });
      if (!liveBuilding) throw new ParkingError("Building not found.", 404);

      const reservedOwnerSpaces = liveBuilding.ownerVehicles.length;
      const transferableOwnerSpaces = Math.max(liveBuilding.ownerParking - reservedOwnerSpaces, 0);

      if (parkingAllocation > transferableOwnerSpaces) {
        throw new ParkingError(
          `Only ${transferableOwnerSpaces} Owner Parking space${transferableOwnerSpaces === 1 ? "" : "s"} can be reassigned to this company.`,
        );
      }

      const activeVehicleCount = await tx.vehicle.count({
        where: {
          companyId: company.id,
          employee: { isPlaceholder: false },
        },
      });
      if (parkingAllocation < activeVehicleCount) {
        throw new ParkingError(
          `This company already has ${activeVehicleCount} active registered vehicle${activeVehicleCount === 1 ? "" : "s"}. Allocate at least ${activeVehicleCount} parking space${activeVehicleCount === 1 ? "" : "s"}.`,
        );
      }

      const duplicate = await tx.company.findFirst({
        where: {
          buildingId: company.buildingId,
          name: { equals: name, mode: "insensitive" },
          NOT: { id: company.id },
        },
        select: { id: true },
      });
      if (duplicate) throw new ParkingError("A company with this name already exists in this building.");

      await tx.building.update({
        where: { id: company.buildingId },
        data: {
          ownerParking: { decrement: parkingAllocation },
          companyParking: { increment: parkingAllocation },
        },
      });

      await tx.company.update({
        where: { id: company.id },
        data: {
          name,
          enabled: true,
          parkingAllocation,
          ownerParkingAllocation: 0,
          employeeParkingAllocation: parkingAllocation,
        },
      });

      return {
        companyName: name,
        enabled: true,
        released: 0,
        allocated: parkingAllocation,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10000,
      timeout: 15000,
    });

    revalidatePath("/dashboard");
    revalidatePath("/access-control/register-cards", "layout");

    return NextResponse.json({
      ok: true,
      message: result.enabled
        ? `${result.companyName} enabled with ${result.allocated} parking space${result.allocated === 1 ? "" : "s"}.`
        : `${result.companyName} disabled. ${result.released} parking space${result.released === 1 ? "" : "s"} moved to Owner Parking. Existing employees were archived and RFID card assignments were released.`,
    });
  } catch (error) {
    console.error("UPDATE_COMPANY_STATUS_FAILED", error);

    if (error instanceof ParkingError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { ok: false, message: "A company with this name already exists in this building." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { ok: false, message: "Unable to update company status." },
      { status: 500 },
    );
  }
}
