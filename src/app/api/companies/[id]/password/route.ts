import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

async function handlePATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== "BUILDING_ADMIN" || !user.buildingId || !hasPermission(user, "building.manageCompanyAccounts")) {
      return NextResponse.json(
        { ok: false, message: "Only the Admin assigned to this building can update company passwords." },
        { status: 403 },
      );
    }

    const { id: companyId } = await context.params;
    const body = await request.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";

    if (!password.trim()) {
      return NextResponse.json({ ok: false, message: "Company password is required." }, { status: 400 });
    }
    if (password.length > 200) {
      return NextResponse.json({ ok: false, message: "Company password is too long." }, { status: 400 });
    }

    const company = await prisma.company.findFirst({
      where: {
        id: companyId,
        buildingId: user.buildingId,
      },
      select: {
        id: true,
        name: true,
        users: {
          where: { role: "COMPANY_ADMIN" },
          orderBy: { createdAt: "asc" },
          select: { id: true, userId: true },
          take: 1,
        },
      },
    });

    if (!company) {
      return NextResponse.json(
        { ok: false, message: "Company not found in your building." },
        { status: 404 },
      );
    }

    const companyAccount = company.users[0];
    if (!companyAccount) {
      return NextResponse.json(
        { ok: false, message: "This company does not have a Company/User login account." },
        { status: 404 },
      );
    }

    await prisma.user.update({
      where: { id: companyAccount.id },
      data: { password },
    });

    revalidatePath("/dashboard");

    return NextResponse.json({
      ok: true,
      message: `${company.name} password updated successfully.`,
      account: { userId: companyAccount.userId },
    });
  } catch (error) {
    console.error("UPDATE_COMPANY_PASSWORD_BY_ADMIN_FAILED", error);
    return NextResponse.json(
      { ok: false, message: "Unable to update the company password." },
      { status: 500 },
    );
  }
}

export const PATCH = withAuditRequest(handlePATCH);
