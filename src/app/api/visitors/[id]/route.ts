import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function handlePATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ ok: false, message: "Sign in required." }, { status: 403 });
    }

    if (!hasPermission(user, user.role === "BUILDING_ADMIN" ? "building.manageVisitors" : "company.manageVisitors")) return NextResponse.json({ ok: false, message: "Visitor management is not allowed for this account." }, { status: 403 });

    const isBuildingAdmin = user.role === "BUILDING_ADMIN";
    const isCompanyUser = user.role === "COMPANY_ADMIN" || user.role === "BUILDING_OWNER";
    if (!isBuildingAdmin && !isCompanyUser) {
      return NextResponse.json({ ok: false, message: "Visitor editing is available only to Admin and Company accounts." }, { status: 403 });
    }

    const { id } = await context.params;
    const visitor = await prisma.visitor.findUnique({
      where: { id },
      select: { id: true, buildingId: true, companyId: true },
    });
    if (!visitor) {
      return NextResponse.json({ ok: false, message: "Visitor not found." }, { status: 404 });
    }

    const allowed = isBuildingAdmin
      ? visitor.buildingId === user.buildingId && visitor.companyId === null
      : visitor.companyId === user.companyId;

    if (!allowed) {
      return NextResponse.json({ ok: false, message: "You do not have access to edit this visitor." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const name = cleanText(body?.name, 120);
    const phoneNumber = cleanText(body?.phoneNumber, 30);
    const email = cleanText(body?.email, 180).toLowerCase();
    const vehicleNumber = cleanText(body?.vehicleNumber, 40).toUpperCase();
    const accessory = cleanText(body?.accessory, 250);
    const validFrom = new Date(String(body?.validFrom ?? ""));
    const validUntil = new Date(String(body?.validUntil ?? ""));
    const phoneDigits = phoneNumber.replace(/\D/g, "");

    if (!name || !phoneNumber || !email || !accessory) {
      return NextResponse.json({ ok: false, message: "Name, Phone Number, Mail, and Accessory are required." }, { status: 400 });
    }
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      return NextResponse.json({ ok: false, message: "Enter a valid Phone Number." }, { status: 400 });
    }
    if (!validEmail(email)) {
      return NextResponse.json({ ok: false, message: "Enter a valid Mail address." }, { status: 400 });
    }
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
      return NextResponse.json({ ok: false, message: "Valid From and Valid Until are required." }, { status: 400 });
    }
    if (validUntil <= validFrom) {
      return NextResponse.json({ ok: false, message: "Valid Until must be later than Valid From." }, { status: 400 });
    }

    const updated = await prisma.visitor.update({
      where: { id },
      data: {
        name,
        phoneNumber,
        email,
        vehicleNumber: vehicleNumber || null,
        accessory,
        validFrom,
        validUntil,
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        email: true,
        vehicleNumber: true,
        accessory: true,
        validFrom: true,
        validUntil: true,
      },
    });

    revalidatePath("/visitor-form");
    revalidatePath("/reports");

    return NextResponse.json({
      ok: true,
      message: "Visitor details updated successfully.",
      visitor: updated,
    });
  } catch (error) {
    console.error("UPDATE_VISITOR_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to update the visitor details. Please try again." }, { status: 500 });
  }
}

export const PATCH = withAuditRequest(handlePATCH);
