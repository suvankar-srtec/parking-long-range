import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rfidUser, rfidApiError } from "@/lib/rfid-access";

export async function GET(request: Request) {
  try {
    const user = await rfidUser();
    const scope = user.role === "SUPER_ADMIN"
      ? {}
      : user.role === "COMPANY_ADMIN"
        ? { companyId: user.companyId! }
        : { buildingId: user.buildingId! };

    const [events, insideVehicles, insideVisitors] = await Promise.all([
      new URL(request.url).searchParams.get("summary") === "1" ? Promise.resolve([]) : prisma.rfidEvent.findMany({
        where: scope,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        include: {
          reader: { select: { name: true } },
          vehicle: { select: { plateNumber: true } },
          visitor: { select: { name: true, vehicleNumber: true } },
          building: { select: { name: true } },
          company: { select: { name: true } },
        },
      }),
      prisma.vehicle.count({
        where: {
          isInside: true,
          ...(user.role === "SUPER_ADMIN"
            ? {}
            : user.role === "COMPANY_ADMIN"
              ? { companyId: user.companyId! }
              : { company: { buildingId: user.buildingId! } }),
        },
      }),
      prisma.visitor.count({
        where: {
          isInside: true,
          ...(user.role === "SUPER_ADMIN"
            ? {}
            : user.role === "COMPANY_ADMIN"
              ? { companyId: user.companyId! }
              : { buildingId: user.buildingId! }),
        },
      }),
    ]);

    return NextResponse.json({ ok: true, events, inside: insideVehicles + insideVisitors }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rfidApiError(error);
  }
}
