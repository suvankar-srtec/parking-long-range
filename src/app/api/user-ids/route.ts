import { canCreateCompanyPeople } from "@/lib/employee-creation";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import { hasPermission } from "@/lib/permissions";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canCreateEntity, normalizeEntityName, type EntityKind } from "@/lib/entity-identity";
import { reserveUserId, UserIdError } from "@/lib/user-id-reservations";
import { prisma } from "@/lib/prisma";
import { nextSupervisorUserId } from "@/lib/supervisor-user-id";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false, message: "Sign in to generate a User ID." }, { status: 403 });
    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 }); }
    const kind = body?.kind as EntityKind;
    if (!["building", "company", "employee", "supervisor"].includes(kind)) {
      return NextResponse.json({ ok: false, message: "Choose a valid account type." }, { status: 400 });
    }
    const scopeId = typeof body.scopeId === "string" ? body.scopeId : "";
    const previousReservationId = typeof body.previousReservationId === "string" ? body.previousReservationId : undefined;

    let allowed = canCreateEntity(user, kind, scopeId);
    if (kind === "company" && allowed) {
      const building = await prisma.building.findUnique({ where: { id: scopeId }, select: { superAdminId: true } });
      allowed = !!building && (user.role === "SUPER_ADMIN"
        ? isPrimarySuperAdmin(user) || building.superAdminId === user.id
        : hasPermission(user, "building.createCompanies"));
    }
    if (kind === "employee") {
      const company = scopeId ? await prisma.company.findUnique({
        where: { id: scopeId }, select: { id: true, buildingId: true, enabled: true },
      }) : null;
      allowed = !!company && company.enabled && canCreateCompanyPeople(user, company);
    }

    if (!allowed) {
      return NextResponse.json({ ok: false, message: "You cannot create this account." }, { status: 403 });
    }

    if (kind === "supervisor") {
      const userId = await nextSupervisorUserId();
      return NextResponse.json({
        ok: true,
        userId,
        reservationId: `DIRECT_SUPERVISOR:${userId}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const name = typeof body.name === "string" ? normalizeEntityName(body.name) : "";
    if (!name || name.length > 120) {
      return NextResponse.json({ ok: false, message: "Enter a name of 1 to 120 characters." }, { status: 400 });
    }
    const reservation = await reserveUserId({ ownerId: user.id, kind, scopeId, name, previousReservationId });
    return NextResponse.json({
      ok: true, userId: reservation.userId, reservationId: reservation.id, expiresAt: reservation.expiresAt.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UserIdError) return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    console.error("GENERATE_USER_ID_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to generate a User ID. Please try again." }, { status: 500 });
  }
}
