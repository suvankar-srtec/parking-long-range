import { canCreateCompanyPeople } from "@/lib/employee-creation";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { claimUserId, UserIdError } from "@/lib/user-id-reservations";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: companyId } = await context.params;
    const owner = await getCurrentUser();
    if (!owner) {
      return NextResponse.json({ ok: false, message: "Sign in required." }, { status: 403 });
    }

    const companyInScope = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, buildingId: true, enabled: true },
    });
    if (!companyInScope || !canCreateCompanyPeople(owner, companyInScope)) {
      return NextResponse.json({ ok: false, message: "You do not have permission to add people to this company." }, { status: 403 });
    }
    if (!companyInScope.enabled) {
      return NextResponse.json({ ok: false, message: "Enable this company before creating employees." }, { status: 409 });
    }

    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 }); }
    const name = String(body?.name ?? "").trim();
    const reservationId = String(body?.reservationId ?? "");
    const category = String(body?.category ?? "EMPLOYEE").toUpperCase();
    const parkingLimit = 1;
    const department = String(body?.department ?? "").trim();
    if (!name || !reservationId || !department) return NextResponse.json({ ok: false, message: "Name, generated User ID, and department are required." }, { status: 400 });
    if (!["EMPLOYEE", "OWNER"].includes(category)) return NextResponse.json({ ok: false, message: "Choose Employee or Company Owner." }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      // Serialize additions so a legacy empty slot is filled only once.
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`;
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { id: true, enabled: true },
      });
      if (!company) throw new UserIdError("Company not found.", 404);
      if (!company.enabled) throw new UserIdError("Enable this company before creating employees.", 409);
      const departmentExists = await tx.companyDepartment.findFirst({
        where: {
          companyId,
          name: department,
          NOT: { name: { startsWith: "__ARCHIVED__" } },
        },
        select: { id: true },
      });
      if (!departmentExists) throw new UserIdError("Select a department created for this company.", 400);

      const claimedUserId = await claimUserId(tx, { ownerId: owner.id, reservationId, kind: "employee", scopeId: companyId, name });
      const emptySlot = await tx.employee.findFirst({
        where: {
          companyId,
          isPlaceholder: true,
          slotNumber: { not: null },
          accountId: null,
          vehicles: { none: {} },
        },
        orderBy: [{ slotNumber: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      const data = { name, userId: claimedUserId, companyId, category, parkingLimit, department, isPlaceholder: false };
      return emptySlot
        ? tx.employee.update({ where: { id: emptySlot.id, isPlaceholder: true }, data })
        : tx.employee.create({ data });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/company-parking");
    revalidatePath(`/access-control/register-cards/${companyId}`);
    return NextResponse.json({ ok: true, message: `${result.category === "OWNER" ? "Company owner" : "Employee"} created successfully.`, employee: { id: result.id, name: result.name, userId: result.userId, category: result.category, parkingLimit: result.parkingLimit, department: result.department } }, { status: 201 });
  } catch (error) {
    if (error instanceof UserIdError) return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ ok: false, message: "This generated User ID is already in use." }, { status: 409 });
    console.error("CREATE_EMPLOYEE_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to create employee or company owner." }, { status: 500 });
  }
}
