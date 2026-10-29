import { withAuditRequest } from "@/lib/audit-request";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

async function canManageCompany(companyId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role === "COMPANY_ADMIN" || user.role === "BUILDING_OWNER") return user.companyId === companyId ? user : null;
  if (user.role === "BUILDING_ADMIN") {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { buildingId: true } });
    return company && company.buildingId === user.buildingId ? user : null;
  }
  if (user.role === "SUPER_ADMIN") {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { building: { select: { superAdminId: true } } } });
    if (!company) return null;
    return !user.createdBySuperAdminId || company.building.superAdminId === user.id ? user : null;
  }
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await context.params;
  const user = await canManageCompany(companyId);
  if (!user) return NextResponse.json({ ok: false, message: "You do not have access to this company's departments." }, { status: 403 });

  const [departments, company] = await Promise.all([
    prisma.companyDepartment.findMany({
      where: {
        companyId,
        NOT: { name: { startsWith: "__ARCHIVED__" } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.company.findUnique({ where: { id: companyId }, select: { maximumDepartments: true } }),
  ]);
  return NextResponse.json({ ok: true, departments, maximumDepartments: company?.maximumDepartments ?? 0 });
}

async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: companyId } = await context.params;
    const user = await canManageCompany(companyId);
    if (!user) return NextResponse.json({ ok: false, message: "You do not have permission to add departments for this company." }, { status: 403 });
    if ((user.role === "COMPANY_ADMIN" || user.role === "BUILDING_OWNER") && !hasPermission(user, "company.managePeople")) {
      return NextResponse.json({ ok: false, message: "Employee management is not assigned to this Company/User account." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const name = String(body?.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) return NextResponse.json({ ok: false, message: "Enter a department name." }, { status: 400 });
    if (name.length > 80) return NextResponse.json({ ok: false, message: "Department name must be 80 characters or less." }, { status: 400 });

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, enabled: true },
    });
    if (!company) throw new Error("COMPANY_NOT_FOUND");
    if (!company.enabled) {
      return NextResponse.json({ ok: false, message: "Enable this company before creating departments." }, { status: 409 });
    }

    const department = await prisma.companyDepartment.create({ data: { companyId, name } });

    revalidatePath("/dashboard");
    revalidatePath("/access-control/register-cards", "layout");
    return NextResponse.json({ ok: true, message: `${department.name} department added.`, department }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "COMPANY_NOT_FOUND") return NextResponse.json({ ok: false, message: "Company not found." }, { status: 404 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ ok: false, message: "This department already exists for the company." }, { status: 409 });
    console.error("CREATE_COMPANY_DEPARTMENT_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to add department." }, { status: 500 });
  }
}

export const POST = withAuditRequest(handlePOST);
