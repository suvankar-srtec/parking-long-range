import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { sendVisitorQrEmail } from "@/lib/visitor-qr-mail";

async function handlePOST(
  _request: Request,
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
      return NextResponse.json({ ok: false, message: "Visitor QR sending is available only to Admin and Company accounts." }, { status: 403 });
    }

    const { id } = await context.params;
    const visitor = await prisma.visitor.findUnique({
      where: { id },
      include: {
        building: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
    });

    if (!visitor) {
      return NextResponse.json({ ok: false, message: "Visitor not found." }, { status: 404 });
    }

    const allowed = isBuildingAdmin
      ? visitor.buildingId === user.buildingId && visitor.companyId === null
      : visitor.companyId === user.companyId;

    if (!allowed) {
      return NextResponse.json({ ok: false, message: "You do not have access to this visitor." }, { status: 403 });
    }

    if (visitor.validUntil <= new Date()) {
      return NextResponse.json({ ok: false, message: "This visitor QR validity has expired. Create a new visitor pass with a new time window." }, { status: 409 });
    }

    const { qrToken } = await sendVisitorQrEmail({
      id: visitor.id,
      name: visitor.name,
      email: visitor.email,
      phoneNumber: visitor.phoneNumber,
      vehicleNumber: visitor.vehicleNumber,
      accessory: visitor.accessory,
      validFrom: visitor.validFrom,
      validUntil: visitor.validUntil,
      scopeName: visitor.company?.name || visitor.building.name,
    });

    await prisma.visitor.update({
      where: { id: visitor.id },
      data: { qrToken, qrEntryUsed: false },
    });

    return NextResponse.json({
      ok: true,
      message: `New visitor QR sent successfully to ${visitor.email}. Previous QR is now disabled.`,
    });
  } catch (error) {
    console.error("SEND_VISITOR_QR_FAILED", error);
    const message = error instanceof Error ? error.message : "Unable to send the visitor QR. Please try again.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export const POST = withAuditRequest(handlePOST);
