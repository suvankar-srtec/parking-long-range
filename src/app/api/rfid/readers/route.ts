import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { READER_MODES } from "@/lib/rfid-reader";
import { rfidUser, rfidApiError, lockRfid, RFID_TRANSACTION } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";
import { hasPermission } from "@/lib/permissions";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import { parseGateConfig, serializeGateConfig } from "@/lib/gate-config";

const MAX_QR_DATA_LENGTH = 1_600_000;
const ADMIN_READER_MODES = new Set(["REGISTER", "ENTRY_EXIT"]);

function validateQrData(value: unknown, label: string) {
  const data = String(value ?? "").trim();
  if (!data) throw new ParkingError(`${label} QR is required.`);
  if (data.length > MAX_QR_DATA_LENGTH) throw new ParkingError(`${label} QR image is too large. Please upload a smaller QR image.`);
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[a-zA-Z0-9+/=\r\n]+$/.test(data)) throw new ParkingError(`${label} QR must be a PNG, JPG, or WEBP image.`);
  return data;
}

function readerSummary<T extends { registrationQrData?: string | null; entryExitQrData?: string | null }>(reader: T) {
  const { registrationQrData, entryExitQrData, ...rest } = reader;
  return { ...rest, hasRegistrationQr: Boolean(registrationQrData), hasEntryExitQr: Boolean(entryExitQrData) };
}

function assertReaderPageAccess(user: Awaited<ReturnType<typeof rfidUser>>) {
  if (user.role === "COMPANY_ADMIN") throw new ParkingError("Reader management is not available to Company/User accounts.", 403);
  if (user.role === "BUILDING_ADMIN" && !hasPermission(user, "building.configureReaders")) {
    throw new ParkingError("Reader configuration is not assigned to this Admin account.", 403);
  }
}

async function assertSuperAdminBuilding(user: Awaited<ReturnType<typeof rfidUser>>, buildingId: string) {
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    select: { id: true, superAdminId: true },
  });
  if (!building) throw new ParkingError("Building not found.", 404);
  if (!isPrimarySuperAdmin(user) && building.superAdminId !== user.id) {
    throw new ParkingError("This building belongs to another Super Admin.", 403);
  }
  return building;
}

export async function GET() {
  try {
    const user = await rfidUser();
    if (user.role === "COMPANY_ADMIN") throw new ParkingError("Reader management is not available to Company/User accounts.", 403);
    if (user.role === "BUILDING_ADMIN" && !["building.configureReaders", "building.configureGates", "building.registerCompanyCards", "building.registerOwnerParking", "building.liveMonitor"].some(key => hasPermission(user, key as import("@/lib/permissions").PermissionKey))) throw new ParkingError("Reader access is not assigned to this account.", 403);

    const primarySuperAdmin = user.role === "SUPER_ADMIN" && isPrimarySuperAdmin(user);
    const canAssignReaders = user.role === "SUPER_ADMIN";
    const canConfigureReaders = user.role === "SUPER_ADMIN" || (user.role === "BUILDING_ADMIN" && hasPermission(user, "building.configureReaders"));

    const configuredReaderWhere = user.role === "SUPER_ADMIN"
      ? (primarySuperAdmin
          ? { buildingId: { not: null } }
          : { building: { superAdminId: user.id } })
      : { enabled: true, buildingId: user.buildingId! };

    const availableReaderWhere = user.role === "SUPER_ADMIN"
      ? { enabled: false, buildingId: null, lastSeenAt: { not: null } }
      : { enabled: false, buildingId: user.buildingId! };

    const buildingWhere = user.role === "SUPER_ADMIN"
      ? (primarySuperAdmin ? undefined : { superAdminId: user.id })
      : { id: user.buildingId! };

    const [readers, availableReaders, buildings] = await Promise.all([
      prisma.rfidReader.findMany({
        where: configuredReaderWhere,
        include: { building: { select: { name: true } } },
        orderBy: { deviceNumber: "asc" },
      }),
      (canAssignReaders || canConfigureReaders)
        ? prisma.rfidReader.findMany({
            where: availableReaderWhere,
            include: { building: { select: { name: true } } },
            orderBy: [{ lastSeenAt: "desc" }, { deviceNumber: "asc" }],
          })
        : Promise.resolve([]),
      prisma.building.findMany({
        where: buildingWhere,
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      readers: readers.map(readerSummary),
      availableReaders: availableReaders.map(readerSummary),
      buildings,
      canManage: canConfigureReaders,
      canAddReaders: canAssignReaders || canConfigureReaders,
      canAssignReaders,
      canConfigureReaders,
      canRemoveReaders: user.role === "SUPER_ADMIN" || canConfigureReaders,
      serverTime: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rfidApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await rfidUser();
    assertReaderPageAccess(user);
    const body = await request.json().catch(() => null);

    if (body?.action === "reset") {
      if (!["SUPER_ADMIN", "BUILDING_ADMIN"].includes(user.role)) {
        throw new ParkingError("Only Super Admin or Building Admin can remove a reader allocation.", 403);
      }

      const deviceNumber = String(body?.deviceNumber ?? "").trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(deviceNumber)) {
        throw new ParkingError("Invalid reader device number.");
      }

      const existing = await prisma.rfidReader.findUnique({
        where: { deviceNumber },
        select: {
          id: true,
          deviceNumber: true,
          buildingId: true,
        },
      });
      if (!existing) throw new ParkingError("Reader not found.", 404);

      if (user.role === "BUILDING_ADMIN") {
        if (!user.buildingId || existing.buildingId !== user.buildingId) {
          throw new ParkingError("You can remove only readers allotted to your own building.", 403);
        }

        await prisma.rfidReader.update({
          where: { id: existing.id },
          data: { enabled: false },
        });

        return NextResponse.json({
          ok: true,
          message: "Reader removed from active configuration. It remains allotted to your building and can be added again.",
        });
      }

      if (!isPrimarySuperAdmin(user) && existing.buildingId) {
        const building = await prisma.building.findUnique({
          where: { id: existing.buildingId },
          select: { superAdminId: true },
        });
        if (building?.superAdminId !== user.id) {
          throw new ParkingError("This reader belongs to another Super Admin.", 403);
        }
      }

      await prisma.rfidReader.update({
        where: { id: existing.id },
        data: {
          enabled: false,
          buildingId: null,
        },
      });

      return NextResponse.json({
        ok: true,
        message: "Reader removed from the building. It is now available for Super Admin allotment.",
      });
    }

    if (body?.action === "assign") {
      if (user.role !== "SUPER_ADMIN") throw new ParkingError("Only Super Admin can allot a reader to a building.", 403);

      const deviceNumber = String(body?.deviceNumber ?? "").trim();
      const name = String(body?.name ?? "").trim();
      const buildingId = String(body?.buildingId ?? "").trim();

      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(deviceNumber) || !name || name.length > 120 || !buildingId) {
        throw new ParkingError("Select a detected reader, enter its name, and choose a building.");
      }
      await assertSuperAdminBuilding(user, buildingId);

      const result = await prisma.$transaction(async (tx) => {
        await lockRfid(tx);
        const existing = await tx.rfidReader.findUnique({ where: { deviceNumber } });
        if (!existing) throw new ParkingError("This physical reader has not contacted the system yet.", 404);
        if (existing.buildingId && existing.buildingId !== buildingId) {
          throw new ParkingError("This reader is already allotted to another building.", 409);
        }

        await tx.rfidEnrollment.updateMany({
          where: { readerId: existing.id, status: { in: ["WAITING", "CAPTURED"] } },
          data: { status: "CANCELLED" },
        });

        return tx.rfidReader.update({
          where: { id: existing.id },
          data: {
            name,
            buildingId,
            enabled: false,
          },
        });
      }, RFID_TRANSACTION);

      return NextResponse.json({
        ok: true,
        reader: readerSummary(result),
        message: "Reader allotted to the building. The Building Admin can now configure its purpose.",
      });
    }

    // Cloud C has software-controlled purposes and does not use setup QR images.
    if (body?.action === "configureCloud" || body?.action === "configureSoftware") {
      const deviceNumber = String(body?.deviceNumber ?? "").trim();
      const mode = String(body?.mode ?? "");
      if (!["REGISTER", "ENTRY_EXIT"].includes(mode)) throw new ParkingError("Select Registration or Entry / Exit.");
      const result = await prisma.$transaction(async (tx) => {
        await lockRfid(tx);
        const existing = await tx.rfidReader.findUnique({ where: { deviceNumber } });
        if (!existing || !["CLOUD_C", "UHF_MM"].includes(existing.readerProtocol)) throw new ParkingError("Software-configurable reader not found.", 404);
        if (!existing.buildingId) throw new ParkingError("Allot this reader to a building first.");
        if (user.role === "SUPER_ADMIN") {
          const building = await tx.building.findUnique({ where: { id: existing.buildingId } });
          if (!isPrimarySuperAdmin(user) && building?.superAdminId !== user.id) throw new ParkingError("This reader belongs to another Super Admin.", 403);
        } else if (user.role !== "BUILDING_ADMIN" || user.buildingId !== existing.buildingId || !hasPermission(user, "building.configureReaders")) {
          throw new ParkingError("Reader configuration is not permitted.", 403);
        }
        if (existing.mode !== mode) {
          await tx.rfidEnrollment.updateMany({ where: { readerId: existing.id, status: { in: ["WAITING", "CAPTURED"] } }, data: { status: "CANCELLED" } });
        }
        return tx.rfidReader.update({ where: { id: existing.id }, data: { mode, enabled: true } });
      }, RFID_TRANSACTION);
      return NextResponse.json({ ok: true, reader: readerSummary(result), message: "Reader configured and enabled." });
    }

    if (!["BUILDING_ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      throw new ParkingError("Reader configuration is not permitted.", 403);
    }
    if (user.role !== "SUPER_ADMIN" && !hasPermission(user, "building.configureReaders")) {
      throw new ParkingError("Reader configuration is not assigned to this Admin account.", 403);
    }

    const deviceNumber = String(body?.deviceNumber ?? "").trim();
    const mode = String(body?.mode ?? "");
    const registrationQrData = body?.registrationQrData === undefined ? undefined : validateQrData(body.registrationQrData, "Registration");
    const entryExitQrData = body?.entryExitQrData === undefined ? undefined : validateQrData(body.entryExitQrData, "Entry / Exit");

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(deviceNumber)) {
      throw new ParkingError("Invalid reader device number.");
    }
    if (!READER_MODES.includes(mode as typeof READER_MODES[number]) || !ADMIN_READER_MODES.has(mode)) {
      throw new ParkingError("Select Registration or Entry / Exit.");
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockRfid(tx);
      const existing = await tx.rfidReader.findUnique({ where: { deviceNumber } });
      if (!existing) throw new ParkingError("Reader not found.", 404);
      if (user.role === "SUPER_ADMIN") {
        const building = existing.buildingId ? await tx.building.findUnique({ where: { id: existing.buildingId } }) : null;
        if (!building || (!isPrimarySuperAdmin(user) && building.superAdminId !== user.id)) throw new ParkingError("Reader configuration is not permitted.", 403);
      } else if (!user.buildingId || existing.buildingId !== user.buildingId) {
        throw new ParkingError("This reader is not allotted to your building.", 403);
      }

      if (existing.mode !== mode) {
        await tx.rfidEnrollment.updateMany({
          where: { readerId: existing.id, status: { in: ["WAITING", "CAPTURED"] } },
          data: { status: "CANCELLED" },
        });
      }

      return tx.rfidReader.update({
        where: { id: existing.id },
        data: {
          mode,
          enabled: true,
          ...(registrationQrData !== undefined ? { registrationQrData } : {}),
          ...(entryExitQrData !== undefined ? { entryExitQrData } : {}),
        },
      });
    }, RFID_TRANSACTION);

    return NextResponse.json({
      ok: true,
      reader: readerSummary(result),
      message: "Reader purpose configured successfully.",
    });
  } catch (error) {
    return rfidApiError(error);
  }
}
