import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

async function handlePATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.role !== "COMPANY_ADMIN" && user.role !== "BUILDING_OWNER") || !user.companyId) {
      return NextResponse.json(
        { ok: false, message: "Only the signed-in company account can update its password." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";

    if (!password.trim()) {
      return NextResponse.json({ ok: false, message: "Company password is required." }, { status: 400 });
    }

    if (password.length > 200) {
      return NextResponse.json({ ok: false, message: "Company password is too long." }, { status: 400 });
    }

    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, companyId: true, role: true },
    });

    if (!account || account.companyId !== user.companyId || (account.role !== "COMPANY_ADMIN" && account.role !== "BUILDING_OWNER")) {
      return NextResponse.json(
        { ok: false, message: "This company account is no longer assigned to the current company." },
        { status: 403 },
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password },
    });

    revalidatePath("/dashboard");
    return NextResponse.json({ ok: true, message: "Company password updated successfully." });
  } catch (error) {
    console.error("UPDATE_COMPANY_PASSWORD_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to update company password." }, { status: 500 });
  }
}

export const PATCH = withAuditRequest(handlePATCH);
