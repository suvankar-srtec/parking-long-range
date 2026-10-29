import { withAuditRequest } from "@/lib/audit-request";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/session";
import { validateParking } from "@/lib/parking";
import { sanitizePermissions } from "@/lib/permissions";
import { createBuildingWithAccount } from "@/lib/create-building";
import { UserIdError } from "@/lib/user-id-reservations";

async function handlePOST(request: Request) {
  try {
    const admin = await requireSuperAdmin();
    if (!admin) {
      return NextResponse.json({ ok: false, message: "Only a Super Admin can create buildings." }, { status: 403 });
    }
    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 }); }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, message: "Building details are required." }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if ("userId" in body) {
      return NextResponse.json({ ok: false, message: "Building User IDs are generated automatically and cannot be supplied." }, { status: 400 });
    }
    const username = name;
    const password = typeof body.password === "string" ? body.password : "";
    const reservationId = typeof body.reservationId === "string" ? body.reservationId : "";
    if (!name || !password.trim() || !reservationId) {
      return NextResponse.json({ ok: false, message: "Building name and password are required." }, { status: 400 });
    }
    const maximumGate = Number(body.maximumGate);
    if (!Number.isInteger(maximumGate) || maximumGate < 1 || maximumGate > 2147483647) {
      return NextResponse.json({ ok: false, message: "Maximum Gate must be a whole number of at least 1." }, { status: 400 });
    }
    const totalParking = body.totalParking;
    const ownerParking = body.ownerParking;
    const visitorParking = body.visitorParking ?? 0;
    const companyParking = body.companyParking ?? (totalParking - ownerParking - visitorParking);
    const parking = validateParking({ totalParking, ownerParking, visitorParking, companyParking });
    if (!parking.ok) {
      return NextResponse.json({ ok: false, message: parking.message }, { status: 400 });
    }
    if (await prisma.building.findUnique({ where: { name }, select: { id: true } })) {
      return NextResponse.json({ ok: false, message: "A building with this name already exists." }, { status: 409 });
    }
    const permissions = sanitizePermissions("BUILDING_ADMIN", body.permissions);
    const result = await createBuildingWithAccount({ name, username, password, maximumGate, ownerId: admin.id, reservationId, permissions, ...parking.values });
    revalidatePath("/dashboard");
    return NextResponse.json({
      ok: true, message: `Building created successfully. User ID: ${result.account.userId}.`,
      building: { id: result.building.id, name: result.building.name, maximumGate: result.building.maximumGate, ...result.account, ...parking.values },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof UserIdError) return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const userIdConflict = String(error.meta?.target ?? "").includes("userId");
      return NextResponse.json({ ok: false, message: userIdConflict ? "Unable to generate a unique building User ID. Please try again." : "A building with this name already exists." }, { status: 409 });
    }
    console.error("CREATE_BUILDING_FAILED");
    return NextResponse.json({ ok: false, message: "Unable to create the building. Please try again." }, { status: 500 });
  }
}

export const POST = withAuditRequest(handlePOST);
