import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { sendVisitorQrEmail } from "@/lib/visitor-qr-mail";

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ ok: false, message: "Sign in required." }, { status: 403 });
    }

    if (!hasPermission(user, user.role === "BUILDING_ADMIN" ? "building.manageVisitors" : "company.manageVisitors")) return NextResponse.json({ ok: false, message: "Visitor management is not allowed for this account." }, { status: 403 });

    const isBuildingAdmin = user.role === "BUILDING_ADMIN";
    const isCompanyUser = user.role === "COMPANY_ADMIN" || user.role === "BUILDING_OWNER";
    if (!isBuildingAdmin && !isCompanyUser) {
      return NextResponse.json({ ok: false, message: "Visitor Form is available only to Admin and Company accounts." }, { status: 403 });
    }

    let buildingId = user.buildingId;
    let companyId: string | null = null;

    if (isCompanyUser) {
      if (!user.companyId) {
        return NextResponse.json({ ok: false, message: "This account is not assigned to a company." }, { status: 409 });
      }
      const company = await prisma.company.findUnique({
        where: { id: user.companyId },
        select: { id: true, buildingId: true, enabled: true },
      });
      if (!company || !company.enabled) {
        return NextResponse.json({ ok: false, message: "The assigned company is not available." }, { status: 409 });
      }
      companyId = company.id;
      buildingId = company.buildingId;
    }

    if (!buildingId) {
      return NextResponse.json({ ok: false, message: "This account is not assigned to a building." }, { status: 409 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
    }

    const data = body as Record<string, unknown>;
    const name = cleanText(data.name, 120);
    const phoneNumber = cleanText(data.phoneNumber, 30);
    const email = cleanText(data.email, 180).toLowerCase();
    const vehicleNumber = cleanText(data.vehicleNumber, 40).toUpperCase();
    const accessory = cleanText(data.accessory, 250);
    const validFrom = new Date(String(data.validFrom ?? ""));
    const validUntil = new Date(String(data.validUntil ?? ""));
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

    const visitor = await prisma.visitor.create({
      data: {
        name,
        phoneNumber,
        email,
        vehicleNumber: vehicleNumber || null,
        accessory,
        validFrom,
        validUntil,
        buildingId,
        companyId,
        createdByUserId: user.id,
      },
      include: {
        building: { select: { name: true } },
        company: { select: { name: true } },
      },
    });

    let emailSent = false;
    let message = "Visitor details saved successfully.";
    try {
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
      emailSent = true;
      message = `Visitor saved and QR pass automatically sent to ${visitor.email}.`;
    } catch (mailError) {
      console.error("AUTO_SEND_VISITOR_QR_FAILED", mailError);
      const reason = mailError instanceof Error ? mailError.message : "Email could not be sent.";
      message = `Visitor saved, but QR email could not be sent: ${reason} Use Send QR to retry.`;
    }

    return NextResponse.json({
      ok: true,
      message,
      emailSent,
      visitor: { id: visitor.id },
    }, { status: 201 });
  } catch (error) {
    console.error("CREATE_VISITOR_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to save visitor details. Please try again." }, { status: 500 });
  }
}
