import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

async function canManageCompany(companyId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role === "COMPANY_ADMIN" || user.role === "BUILDING_OWNER") return user.companyId === companyId && hasPermission(user, "company.managePeople") ? user : null;
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

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; departmentId: string }> }) {
  try {
    const { id: companyId, departmentId } = await context.params;
    const user = await canManageCompany(companyId);
    if (!user) return NextResponse.json({ ok: false, message: "You do not have permission to delete departments for this company." }, { status: 403 });

    const result = await prisma.$transaction(async (tx) => {
      const department = await tx.companyDepartment.findFirst({ where: { id: departmentId, companyId } });
      if (!department) return null;

      await tx.employee.updateMany({ where: { companyId, department: department.name }, data: { department: "Unassigned" } });
      await tx.vehicle.updateMany({ where: { companyId, department: department.name }, data: { department: "Unassigned" } });
      await tx.companyDepartment.delete({ where: { id: department.id } });
      return department;
    });

    if (!result) return NextResponse.json({ ok: false, message: "Department not found." }, { status: 404 });
    revalidatePath("/dashboard");
    revalidatePath("/access-control/register-cards", "layout");
    return NextResponse.json({ ok: true, message: `${result.name} department deleted.` });
  } catch (error) {
    console.error("DELETE_COMPANY_DEPARTMENT_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to delete department." }, { status: 500 });
  }
}
