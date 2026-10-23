import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";
import { rfidApiError } from "@/lib/rfid-access";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) throw new ParkingError("Admin or Super Admin access required.", 403);
    const { id } = await context.params;
    const building = await prisma.building.findUnique({ where: { id }, select: { superAdminId: true } });
    if (!building) throw new ParkingError("Building not found.", 404);
    if (user.role === "BUILDING_ADMIN" ? user.buildingId !== id : !isPrimarySuperAdmin(user) && building.superAdminId !== user.id) {
      throw new ParkingError("You do not have permission to update this building.", 403);
    }
    const body = await request.json().catch(() => null);
    const keys = ["parkingLimitsEnabled", "antiPassbackEnabled"];
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length < 1 ||
        Object.keys(body).some(key => !keys.includes(key)) || Object.keys(body).some(key => typeof body[key] !== "boolean")) {
      throw new ParkingError("Send boolean parkingLimitsEnabled or antiPassbackEnabled settings.");
    }
    const policy = await prisma.$transaction(async tx => {
      await lockBuildingParking(tx, id);
      const result = await tx.building.update({ where: { id },
        data: { parkingLimitsEnabled: body.parkingLimitsEnabled, antiPassbackEnabled: body.antiPassbackEnabled },
        select: { parkingLimitsEnabled: true, antiPassbackEnabled: true } });
      // Request a fresh memory plan on the next controller heartbeat.
      const readers = await tx.rfidReader.findMany({ where: { buildingId: id, readerProtocol: "CLOUD_C" }, select: { deviceNumber: true } });
      const serials = [...new Set(readers.map(reader => reader.deviceNumber.replace(/-[AB]$/, "")))];
      if (serials.length) await tx.cloudCOffline.updateMany({ where: { serial: { in: serials } }, data: { checkedAt: null } });
      return result;
    }, { maxWait: 10000, timeout: 20000 });
    return NextResponse.json({ ok: true, message: "Access settings saved. Connected devices will sync automatically.", policy });
  } catch (error) { return rfidApiError(error); }
}
