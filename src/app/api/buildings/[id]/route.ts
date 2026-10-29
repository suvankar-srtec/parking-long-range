import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { validateParking } from "@/lib/parking";
import { hasPermission } from "@/lib/permissions";
import { lockBuildingParking, ParkingError, updateBuildingParking } from "@/lib/building-parking";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

async function handlePATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) {
      return NextResponse.json({ ok: false, message: "Super Admin or Building Admin access required." }, { status: 403 });
    }

    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 }); }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, message: "Building settings are required." }, { status: 400 });
    }
    if ("userId" in body) {
      return NextResponse.json({ ok: false, message: "Building User IDs cannot be changed." }, { status: 400 });
    }

    const { id } = await context.params;
    const building = await prisma.building.findUnique({
      where: { id },
      select: { id: true, name: true, maximumGate: true, superAdminId: true },
    });
    if (!building) {
      return NextResponse.json({ ok: false, message: "Building not found." }, { status: 404 });
    }

    const allowed = user.role === "BUILDING_ADMIN"
      ? user.buildingId === id
      : isPrimarySuperAdmin(user) || building.superAdminId === user.id;
    if (!allowed) {
      return NextResponse.json({ ok: false, message: "You do not have permission to update this building." }, { status: 403 });
    }

    const bodyRecord = body as Record<string, unknown>;
    const hasCredentialField = "password" in bodyRecord || "buildingName" in bodyRecord;
    if (hasCredentialField) {
      const allowedKeys = new Set(["password", "buildingName"]);
      if (Object.keys(bodyRecord).some((key) => !allowedKeys.has(key))) {
        return NextResponse.json({ ok: false, message: "Send only buildingName and password when updating building login details." }, { status: 400 });
      }

      const password = typeof bodyRecord.password === "string" ? bodyRecord.password : "";
      if (!password.trim()) {
        return NextResponse.json({ ok: false, message: "Building password is required." }, { status: 400 });
      }

      let nextBuildingName = building.name;
      if ("buildingName" in bodyRecord) {
        if (user.role !== "SUPER_ADMIN") {
          return NextResponse.json({ ok: false, message: "Only a Super Admin can change the building name." }, { status: 403 });
        }
        nextBuildingName = typeof bodyRecord.buildingName === "string" ? bodyRecord.buildingName.trim() : "";
        if (!nextBuildingName) {
          return NextResponse.json({ ok: false, message: "Building name is required." }, { status: 400 });
        }
        const duplicate = await prisma.building.findFirst({
          where: { name: nextBuildingName, NOT: { id } },
          select: { id: true },
        });
        if (duplicate) {
          return NextResponse.json({ ok: false, message: "Another building already uses this name." }, { status: 409 });
        }
      }

      const account = await prisma.user.findFirst({
        where: { role: "BUILDING_ADMIN", buildingId: id, ...(user.role === "BUILDING_ADMIN" ? { id: user.id } : {}) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, userId: true },
      });
      if (!account) {
        return NextResponse.json({ ok: false, message: "Building administrator account not found." }, { status: 404 });
      }

      const [updatedBuilding] = await prisma.$transaction([
        prisma.building.update({
          where: { id },
          data: user.role === "SUPER_ADMIN" ? { name: nextBuildingName } : {},
          select: { id: true, name: true },
        }),
        prisma.user.update({
          where: { id: account.id },
          data: { password },
          select: { userId: true },
        }),
      ]);

      revalidatePath("/dashboard");
      revalidatePath(`/dashboard/buildings/${id}`);
      revalidatePath("/access-control", "layout");
      revalidatePath("/reports");
      return NextResponse.json({ ok: true, message: "Building details updated.", building: updatedBuilding });
    }

    if ("enabled" in bodyRecord) {
      if (user.role !== "SUPER_ADMIN") {
        return NextResponse.json({ ok: false, message: "Only a Super Admin can enable or disable buildings." }, { status: 403 });
      }
      if (typeof bodyRecord.enabled !== "boolean" || Object.keys(bodyRecord).some((key) => key !== "enabled")) {
        return NextResponse.json({ ok: false, message: "Send only a boolean enabled setting." }, { status: 400 });
      }
      const enabled = bodyRecord.enabled;
      const updated = await prisma.$transaction(async (tx) => {
        await lockBuildingParking(tx, id);
        return tx.building.update({ where: { id }, data: { enabled }, select: { id: true, enabled: true } });
      }, { maxWait: 10000, timeout: 20000 });
      revalidatePath("/dashboard", "layout");
      revalidatePath("/account");
      revalidatePath("/access-control", "layout");
      return NextResponse.json({ ok: true, message: enabled ? "Building enabled." : "Building disabled. Existing vehicles can still exit.", building: updated });
    }

    if (user.role === "BUILDING_ADMIN" && (!hasPermission(user, "building.allocateCompanyParking") || !hasPermission(user, "building.manageOwnerParking"))) {
      return NextResponse.json({ ok: false, message: "Parking allocation management is not assigned to this Admin account." }, { status: 403 });
    }

    const parsed = validateParking(bodyRecord);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, message: parsed.message }, { status: 400 });
    }

    const requestedMaximumGate = Number(bodyRecord.maximumGate);
    const maximumGate = "maximumGate" in bodyRecord ? requestedMaximumGate : building.maximumGate;

    if (!Number.isInteger(maximumGate) || maximumGate < 1 || maximumGate > 2147483647) {
      return NextResponse.json({ ok: false, message: "Maximum Gate must be a whole number of at least 1." }, { status: 400 });
    }

    const updated = await updateBuildingParking(id, parsed.values, maximumGate);
    revalidatePath("/account");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/parking-allocation");
    revalidatePath(`/dashboard/buildings/${id}`);
    revalidatePath("/access-control/gate-details");
    return NextResponse.json({ ok: true, message: "Building settings saved.", building: updated });
  } catch (error) {
    if (error instanceof ParkingError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    console.error("UPDATE_BUILDING_PARKING_FAILED");
    return NextResponse.json({ ok: false, message: "Unable to save building settings. Please try again." }, { status: 500 });
  }
}

async function handleDELETE() {
  return NextResponse.json({ ok: false, message: "Buildings cannot be deleted. A Super Admin can disable the building instead." }, { status: 405, headers: { Allow: "PATCH" } });
}

export const PATCH = withAuditRequest(handlePATCH);
export const DELETE = withAuditRequest(handleDELETE);
