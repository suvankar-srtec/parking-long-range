import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";

async function requireRootSuperAdmin() {
  const user = await getCurrentUser();
  if (!user || !isPrimarySuperAdmin(user)) return null;
  return user;
}

export async function GET() {
  const user = await requireRootSuperAdmin();
  if (!user) return NextResponse.json({ ok: false, message: "Primary Super Admin access required." }, { status: 403 });

  const admins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN", id: { not: user.id } },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true, username: true, createdAt: true, _count: { select: { ownedBuildings: true } } },
  });
  return NextResponse.json({ ok: true, admins });
}

async function handlePOST(request: Request) {
  const creator = await requireRootSuperAdmin();
  if (!creator) return NextResponse.json({ ok: false, message: "Only the primary Super Admin can create another Super Admin." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  if (!username || !password.trim()) {
    return NextResponse.json({ ok: false, message: "Name and password are required." }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(72015002)::text`;
    const rows = await tx.$queryRaw<Array<{ userId: string }>>`
      SELECT 'SA' || lpad(n::text, 2, '0') AS "userId"
      FROM generate_series(1, 9999) n
      WHERE NOT EXISTS (
        SELECT 1 FROM users u WHERE upper(u."userId") = 'SA' || lpad(n::text, 2, '0')
      )
      ORDER BY n
      LIMIT 1
    `;
    const userId = rows[0]?.userId;
    if (!userId) throw new Error("NO_SUPER_ADMIN_ID");
    return tx.user.create({
      data: {
        userId,
        username,
        password,
        role: "SUPER_ADMIN",
        createdBySuperAdminId: creator.id,
      },
      select: { id: true, userId: true, username: true, createdAt: true },
    });
  }, { maxWait: 10000, timeout: 15000 });

  return NextResponse.json({ ok: true, message: `Super Admin created successfully. User ID: ${result.userId}.`, admin: result }, { status: 201 });
}

async function handlePATCH(request: Request) {
  const currentUser = await requireRootSuperAdmin();
  if (!currentUser) {
    return NextResponse.json({ ok: false, message: "Only the primary Super Admin can edit another Super Admin." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const adminId = String(body?.id ?? "").trim();
  const username = String(body?.username ?? "").trim();

  if (!adminId) {
    return NextResponse.json({ ok: false, message: "Super Admin ID is required." }, { status: 400 });
  }
  if (!username) {
    return NextResponse.json({ ok: false, message: "Super Admin name is required." }, { status: 400 });
  }
  if (username.length > 120) {
    return NextResponse.json({ ok: false, message: "Super Admin name is too long." }, { status: 400 });
  }
  if (adminId === currentUser.id) {
    return NextResponse.json({ ok: false, message: "Edit your primary account from its account settings." }, { status: 400 });
  }

  const target = await prisma.user.findFirst({
    where: { id: adminId, role: "SUPER_ADMIN" },
    select: { id: true, userId: true },
  });
  if (!target) {
    return NextResponse.json({ ok: false, message: "Super Admin account not found." }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { username },
    select: { id: true, userId: true, username: true, createdAt: true },
  });

  return NextResponse.json({
    ok: true,
    message: `Super Admin ${updated.userId} updated successfully.`,
    admin: updated,
  });
}

async function handleDELETE(request: Request) {
  const currentUser = await requireRootSuperAdmin();
  if (!currentUser) {
    return NextResponse.json({ ok: false, message: "Only the primary Super Admin can remove another Super Admin." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const adminId = String(body?.id ?? "").trim();
  if (!adminId) {
    return NextResponse.json({ ok: false, message: "Super Admin ID is required." }, { status: 400 });
  }
  if (adminId === currentUser.id) {
    return NextResponse.json({ ok: false, message: "You cannot remove your own primary Super Admin account." }, { status: 400 });
  }

  const target = await prisma.user.findFirst({
    where: { id: adminId, role: "SUPER_ADMIN" },
    select: {
      id: true,
      userId: true,
      username: true,
      _count: { select: { ownedBuildings: true } },
    },
  });

  if (!target) {
    return NextResponse.json({ ok: false, message: "Super Admin account not found." }, { status: 404 });
  }

  if (target._count.ownedBuildings > 0) {
    return NextResponse.json({
      ok: false,
      message: `Cannot remove ${target.username}. Reassign or remove the ${target._count.ownedBuildings} building${target._count.ownedBuildings === 1 ? "" : "s"} assigned to this Super Admin first.`,
    }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(72015002)::text`;
    await tx.user.delete({ where: { id: target.id } });
  }, { maxWait: 10000, timeout: 15000 });

  return NextResponse.json({ ok: true, message: `Super Admin ${target.userId} removed successfully.` });
}

export const POST = withAuditRequest(handlePOST);
export const PATCH = withAuditRequest(handlePATCH);
export const DELETE = withAuditRequest(handleDELETE);
