import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { renderVisitorPassPng } from "@/lib/visitor-pass-image";

function formatIndia(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

export async function GET(
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
      return NextResponse.json({ ok: false, message: "Visitor QR download is available only to Admin and Company accounts." }, { status: 403 });
    }

    const { id } = await context.params;
    const visitor = await prisma.visitor.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        buildingId: true,
        companyId: true,
        validFrom: true,
        validUntil: true,
        phoneNumber: true,
        vehicleNumber: true,
        accessory: true,
        qrToken: true,
        building: { select: { name: true } },
        company: { select: { name: true } },
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
      return NextResponse.json({
        ok: false,
        message: "This visitor QR validity has expired.",
      }, { status: 409 });
    }

    let token = visitor.qrToken;
    if (!token) {
      token = randomUUID().replaceAll("-", "");
      await prisma.visitor.update({
        where: { id: visitor.id },
        data: { qrToken: token, qrEntryUsed: false },
      });
    }

    const qrPayload = `SRTEC-VISITOR|ID:${visitor.id}|TOKEN:${token}`;
    const qrResponse = await fetch("https://quickchart.io/qr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: qrPayload,
        size: 700,
        format: "png",
        margin: 2,
        ecLevel: "M",
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!qrResponse.ok) {
      console.error("VISITOR_QR_DOWNLOAD_GENERATION_FAILED", qrResponse.status);
      return NextResponse.json({ ok: false, message: "Unable to generate the visitor QR." }, { status: 502 });
    }

    const qrBytes = Buffer.from(await qrResponse.arrayBuffer());
    const qrDataUrl = `data:image/png;base64,${qrBytes.toString("base64")}`;
    const passBytes = await renderVisitorPassPng({
      visitorName: visitor.name,
      scopeName: visitor.company?.name || visitor.building.name,
      phoneNumber: visitor.phoneNumber,
      vehicleNumber: visitor.vehicleNumber || "Not provided",
      accessory: visitor.accessory,
      validFrom: formatIndia(visitor.validFrom),
      validUntil: formatIndia(visitor.validUntil),
      qrDataUrl,
    });
    const safeName = visitor.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "visitor";

    return new Response(new Uint8Array(passBytes), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="visitor-pass-${safeName}.png"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("DOWNLOAD_VISITOR_QR_FAILED", error);
    return NextResponse.json({ ok: false, message: "Unable to download the visitor QR." }, { status: 500 });
  }
}
