import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { lockBuildingParking, ParkingError } from "@/lib/building-parking";
import { normalizeCard, SCAN_DEBOUNCE_MS, type ParsedRfidReaderMessage } from "@/lib/rfid-reader";
import { parseGateConfig, gateReaderDirection } from "@/lib/gate-config";

export const RFID_TRANSACTION = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 20000 };
const CAPTURED_SAVE_WINDOW_MS = 5 * 60 * 1000;
const READER_SUCCESS_CODE = "0000";
const READER_NO_SUCCESS_CODE = "0001";

export async function lockRfid(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(72015002)::text`;
}
export async function rfidUser() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "BUILDING_ADMIN", "COMPANY_ADMIN"].includes(user.role)) throw new ParkingError("Sign in to manage RFID access.", 403);
  if (user.role !== "SUPER_ADMIN" && !user.buildingId) throw new ParkingError("No building is assigned to this account.", 403);
  if (user.role === "COMPANY_ADMIN" && !user.companyId) throw new ParkingError("No company is assigned to this account.", 403);
  return user;
}
export function rfidApiError(error: unknown) {
  if (error instanceof ParkingError) return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ ok: false, message: "This reader or card is already registered, or the reader is busy." }, { status: 409 });
  }
  console.error("RFID_OPERATION_FAILED", error);
  return NextResponse.json({ ok: false, message: "Unable to complete the RFID request. Please try again." }, { status: 500 });
}
export async function expireEnrollments(tx: Prisma.TransactionClient) {
  await tx.rfidEnrollment.updateMany({
    where: { status: { in: ["WAITING", "CAPTURED"] }, expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
}

export async function processReaderScan(input: ParsedRfidReaderMessage, transport: "HTTP" | "TCP" = "HTTP") {
  const rawScan = input.decodedResult.trim();
  // Accept the current compact visitor QR and the earlier QR format that also
  // included BUILDING / COMPANY fields, so already-emailed passes keep working.
  const visitorMatch = /^SRTEC-VISITOR\|ID:([^|]{1,80})(?:\|.*)?$/i.exec(rawScan);
  const visitorId = visitorMatch?.[1]?.trim() || null;
  const visitorTokenMatch = /(?:^|\|)TOKEN:([^|]{1,80})(?:\||$)/i.exec(rawScan);
  const scannedVisitorToken = visitorTokenMatch?.[1]?.trim() || null;
  const cardNo = visitorId ? "VISITOR-QR" : normalizeCard(input.decodedResult);
  const receivedAt = Date.now();
  return prisma.$transaction(async (tx) => {
    await lockRfid(tx);
    const now = new Date();
    const reader = await tx.rfidReader.upsert({
      where: { deviceNumber: input.deviceNumber },
      create: {
        deviceNumber: input.deviceNumber,
        name: "Reader " + input.deviceNumber,
        lastSeenAt: now,
        connectionType: transport,
        tcpConnected: transport === "TCP",
      },
      update: {
        lastSeenAt: now,
        connectionType: transport,
        ...(transport === "HTTP" ? { tcpConnected: false } : {}),
      },
    });

    async function record(
      code: string,
      message: string,
      action = "DENIED",
      vehicleId?: string,
      companyId?: string,
      ownerVehicleId?: string,
      scannedVisitorId?: string,
    ) {
      const readerCode = code === READER_SUCCESS_CODE ? READER_SUCCESS_CODE : READER_NO_SUCCESS_CODE;
      await tx.rfidEvent.create({ data: {
        readerId: reader.id,
        buildingId: reader.buildingId,
        deviceNumber: reader.deviceNumber,
        cardNo,
        action,
        code: readerCode,
        message,
        vehicleId,
        companyId,
        ownerVehicleId,
        visitorId: scannedVisitorId,
      } });
      return { code: readerCode, message };
    }

    if (!reader.enabled || !reader.buildingId) return record("1004", "Reader must be assigned to a building and enabled.");
    const previousScan = await tx.rfidEvent.findFirst({ where: {
      readerId: reader.id, code: { in: ["0000", "0001"] }, action: { not: "DUPLICATE" },
      createdAt: { gt: new Date(now.getTime() - SCAN_DEBOUNCE_MS) },
    }, orderBy: { createdAt: "desc" } });
    if (previousScan) return record(READER_NO_SUCCESS_CODE, "Duplicate scan ignored. Reader pauses for 1 second.", "DUPLICATE",
      previousScan.cardNo === cardNo ? previousScan.vehicleId || undefined : undefined,
      previousScan.cardNo === cardNo ? previousScan.companyId || undefined : undefined,
      previousScan.cardNo === cardNo ? previousScan.ownerVehicleId || undefined : undefined,
      previousScan.cardNo === cardNo ? previousScan.visitorId || undefined : undefined);
    await lockBuildingParking(tx, reader.buildingId);

    const buildingStatus = await tx.building.findUniqueOrThrow({
      where: { id: reader.buildingId },
      select: { enabled: true },
    });
    if (reader.mode === "REGISTER" && !buildingStatus.enabled) {
      return record(READER_NO_SUCCESS_CODE, "Building is disabled. Card registration is unavailable.");
    }

    if (reader.mode === "REGISTER") {
      await expireEnrollments(tx);
      const enrollment = await tx.rfidEnrollment.findFirst({
        where: { readerId: reader.id, status: { in: ["WAITING", "CAPTURED"] } },
      });
      if (!enrollment) return record("1005", "Reader is in register mode.");

      if (enrollment.ownerParking) {
        if (enrollment.buildingId !== reader.buildingId) return record("1004", "Registration belongs to another building.");
      } else {
        if (!enrollment.companyId) return record("1004", "Registration is missing company information.");
        const company = await tx.company.findUnique({
          where: { id: enrollment.companyId },
          select: { buildingId: true, enabled: true },
        });
        if (company?.buildingId !== reader.buildingId) return record("1004", "Registration belongs to another building.");
        if (!company.enabled) return record(READER_NO_SUCCESS_CODE, "Company is disabled. Card registration is unavailable.");
      }

      if (enrollment.status === "CAPTURED") {
        return record(
          READER_NO_SUCCESS_CODE,
          enrollment.cardNo === cardNo ? "Card already captured; waiting for registration to be saved." : "A card is already captured. Finish or cancel registration.",
          "IGNORED",
          enrollment.vehicleId || undefined,
          enrollment.companyId || undefined,
        );
      }

      const [assignedVehicle, assignedOwnerVehicle] = await Promise.all([
        tx.vehicle.findUnique({ where: { rfidCardNo: cardNo }, select: { id: true } }),
        tx.buildingOwnerVehicle.findUnique({ where: { rfidCardNo: cardNo }, select: { id: true } }),
      ]);
      if ((assignedVehicle && assignedVehicle.id !== enrollment.vehicleId) || assignedOwnerVehicle) {
        await tx.rfidEnrollment.update({
          where: { id: enrollment.id },
          data: { cardNo, status: "DUPLICATE" },
        });
        return record(
          "1006",
          "This RFID card is already assigned to another vehicle.",
          "DENIED",
          assignedVehicle?.id,
          enrollment.companyId || undefined,
          assignedOwnerVehicle?.id,
        );
      }

      await tx.rfidEnrollment.update({
        where: { id: enrollment.id },
        data: {
          cardNo,
          status: "CAPTURED",
          expiresAt: new Date(Date.now() + CAPTURED_SAVE_WINDOW_MS),
        },
      });
      return record(
        READER_NO_SUCCESS_CODE,
        "Card captured. Save the vehicle to complete registration.",
        "CAPTURE",
        enrollment.vehicleId || undefined,
        enrollment.companyId || undefined,
      );
    }

    if (visitorId) {
      const visitor = await tx.visitor.findUnique({
        where: { id: visitorId },
        include: { company: { select: { id: true, enabled: true, buildingId: true, visitorParkingAllocation: true } } },
      });
      if (!visitor) return record(READER_NO_SUCCESS_CODE, "Visitor QR is not registered", "DENIED", undefined, undefined, undefined, visitorId);

      // Legacy QR passes remain valid only until the first replacement QR is sent.
      // Once qrToken is set, only the latest emailed QR is accepted.
      if (visitor.qrToken && scannedVisitorToken !== visitor.qrToken) {
        return record(READER_NO_SUCCESS_CODE, "New QR generated", "DENIED", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }

      if (visitor.buildingId !== reader.buildingId) {
        return record(READER_NO_SUCCESS_CODE, "Visitor QR belongs to another building", "DENIED", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }
      if (visitor.company && (!visitor.company.enabled || visitor.company.buildingId !== reader.buildingId)) {
        return record(READER_NO_SUCCESS_CODE, "Visitor company is not active in this building", "DENIED", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }

      const buildingGates = await tx.gate.findMany({
        where: { buildingId: reader.buildingId },
        select: { gateNumber: true, direction: true },
        orderBy: { gateNumber: "asc" },
      });
      const allottedGate = buildingGates
        .map((gate) => ({ gate, config: parseGateConfig(gate.direction) }))
        .find(({ config }) => config.entryReaderId === reader.id || config.exitReaderId === reader.id);
      if (!allottedGate) {
        return record(READER_NO_SUCCESS_CODE, "Reader is not allotted to a gate.", "DENIED", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }

      const effectiveMode = gateReaderDirection(allottedGate.config, reader.id);
      if (!["ENTRY_EXIT", "ENTRY", "EXIT"].includes(effectiveMode)) {
        return record(READER_NO_SUCCESS_CODE, "Gate direction must be configured before scanning.", "DENIED", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }

      if (visitor.lastAccessDevice === reader.deviceNumber && visitor.lastAccessAt && receivedAt - visitor.lastAccessAt.getTime() < SCAN_DEBOUNCE_MS) {
        return record(READER_NO_SUCCESS_CODE, "Duplicate scan ignored", "DUPLICATE", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }

      let enter: boolean;
      if (effectiveMode === "ENTRY_EXIT") {
        enter = !visitor.isInside;
      } else if (effectiveMode === "ENTRY") {
        if (visitor.isInside) return record(READER_NO_SUCCESS_CODE, "Duplicate entry: visitor is already inside. Exit before another Entry.", "DUPLICATE", undefined, visitor.companyId || undefined, undefined, visitor.id);
        enter = true;
      } else {
        if (!visitor.isInside) return record(READER_NO_SUCCESS_CODE, "Visitor is already outside.", "IGNORED", undefined, visitor.companyId || undefined, undefined, visitor.id);
        enter = false;
      }

      if (enter && visitor.qrEntryUsed) {
        return record(READER_NO_SUCCESS_CODE, "Visitor QR already used", "DENIED", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }

      // The validity window restricts ENTRY only. A visitor who entered while
      // the QR was valid must always be able to EXIT, even after validUntil.
      if (enter && now < visitor.validFrom) {
        return record(READER_NO_SUCCESS_CODE, "Visitor QR is not valid yet", "DENIED", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }
      if (enter && now > visitor.validUntil) {
        return record(READER_NO_SUCCESS_CODE, "Visitor QR validity has expired", "DENIED", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }

      if (enter && !buildingStatus.enabled) {
        return record(READER_NO_SUCCESS_CODE, "Building is disabled. Entry is not allowed.", "DENIED", undefined, visitor.companyId || undefined, undefined, visitor.id);
      }

      if (enter) {
        const [companyVehicleInside, companyVisitorInside, ownerInside, adminVisitorInside, building] = await Promise.all([
          tx.vehicle.count({ where: { isInside: true, company: { buildingId: reader.buildingId } } }),
          tx.visitor.count({ where: { buildingId: reader.buildingId, companyId: { not: null }, isInside: true } }),
          tx.buildingOwnerVehicle.count({ where: { buildingId: reader.buildingId, isInside: true } }),
          tx.visitor.count({ where: { buildingId: reader.buildingId, companyId: null, isInside: true } }),
          tx.building.findUniqueOrThrow({
            where: { id: reader.buildingId },
            select: { companyParking: true, visitorParking: true, totalParking: true },
          }),
        ]);
        const companyPoolInside = companyVehicleInside + companyVisitorInside;
        const totalInside = companyPoolInside + ownerInside + adminVisitorInside;

        if (visitor.companyId) {
          const sameCompanyVisitorsInside = await tx.visitor.count({
            where: { companyId: visitor.companyId, isInside: true },
          });
          if (
            sameCompanyVisitorsInside >= (visitor.company?.visitorParkingAllocation ?? 0) ||
            companyPoolInside >= building.companyParking ||
            totalInside >= building.totalParking
          ) {
            return record(READER_NO_SUCCESS_CODE, "Company Visitor parking allocation is full", "DENIED", undefined, visitor.companyId, undefined, visitor.id);
          }
        } else if (
          adminVisitorInside >= building.visitorParking ||
          totalInside >= building.totalParking
        ) {
          return record(READER_NO_SUCCESS_CODE, "Visitor parking allocation is full", "DENIED", undefined, undefined, undefined, visitor.id);
        }
      }

      await tx.visitor.update({
        where: { id: visitor.id },
        data: {
          isInside: enter,
          qrEntryUsed: true,
          lastAccessAt: now,
          lastAccessDevice: reader.deviceNumber,
        },
      });
      return record(
        READER_SUCCESS_CODE,
        enter ? "Parking allowed - Visitor" : "Visitor checked out",
        enter ? "ENTRY" : "EXIT",
        undefined,
        visitor.companyId || undefined,
        undefined,
        visitor.id,
      );
    }

    const [vehicle, ownerVehicle] = await Promise.all([
      tx.vehicle.findUnique({
        where: { rfidCardNo: cardNo },
        include: {
          company: true,
          employee: { select: { category: true, isPlaceholder: true } },
        },
      }),
      tx.buildingOwnerVehicle.findUnique({ where: { rfidCardNo: cardNo } }),
    ]);

    if (!vehicle && !ownerVehicle) return record(READER_NO_SUCCESS_CODE, "RFID card is not registered");
    if (vehicle?.rfidBlocked || ownerVehicle?.rfidBlocked) {
      return record(
        READER_NO_SUCCESS_CODE,
        "RFID card is blocked",
        "DENIED",
        vehicle?.id,
        vehicle?.companyId,
        ownerVehicle?.id,
      );
    }
    if (vehicle && (!vehicle.company.enabled || vehicle.employee.isPlaceholder)) {
      return record(READER_NO_SUCCESS_CODE, "This company employee is inactive.", "DENIED", vehicle.id, vehicle.companyId);
    }
    if (vehicle && vehicle.company.buildingId !== reader.buildingId) return record("1004", "Card belongs to another building.");
    if (ownerVehicle && ownerVehicle.buildingId !== reader.buildingId) return record("1004", "Card belongs to another building.");

    const buildingGates = await tx.gate.findMany({
      where: { buildingId: reader.buildingId },
      select: { gateNumber: true, direction: true },
      orderBy: { gateNumber: "asc" },
    });
    const allottedGate = buildingGates
      .map((gate) => ({ gate, config: parseGateConfig(gate.direction) }))
      .find(({ config }) => config.entryReaderId === reader.id || config.exitReaderId === reader.id);
    if (!allottedGate) {
      return record(
        READER_NO_SUCCESS_CODE,
        "Reader is not allotted to a gate.",
        "DENIED",
        vehicle?.id,
        vehicle?.companyId,
        ownerVehicle?.id,
      );
    }

    const effectiveMode = gateReaderDirection(allottedGate.config, reader.id);
      if (!["ENTRY_EXIT", "ENTRY", "EXIT"].includes(effectiveMode)) {
      return record(
        READER_NO_SUCCESS_CODE,
        "Gate direction must be configured before scanning.",
        "DENIED",
        vehicle?.id,
        vehicle?.companyId,
        ownerVehicle?.id,
      );
    }

    const currentInside = ownerVehicle ? ownerVehicle.isInside : vehicle!.isInside;
    const lastAccessAt = ownerVehicle ? ownerVehicle.lastAccessAt : vehicle!.lastAccessAt;
    if ((ownerVehicle?.lastAccessDevice || vehicle?.lastAccessDevice) === reader.deviceNumber && lastAccessAt && receivedAt - lastAccessAt.getTime() < SCAN_DEBOUNCE_MS) {
      return record(READER_NO_SUCCESS_CODE, "Duplicate scan ignored", "DUPLICATE", vehicle?.id, vehicle?.companyId, ownerVehicle?.id);
    }

    let enter: boolean;
    if (effectiveMode === "ENTRY_EXIT") {
      enter = !currentInside;
    } else if (effectiveMode === "ENTRY") {
      if (currentInside) return record(READER_NO_SUCCESS_CODE, "Duplicate entry: vehicle is already inside. Exit before another Entry.", "DUPLICATE", vehicle?.id, vehicle?.companyId, ownerVehicle?.id);
      enter = true;
    } else {
      if (!currentInside) return record(READER_NO_SUCCESS_CODE, "Vehicle is already outside.", "IGNORED", vehicle?.id, vehicle?.companyId, ownerVehicle?.id);
      enter = false;
    }

    if (enter && !buildingStatus.enabled) {
      return record(READER_NO_SUCCESS_CODE, "Building is disabled. Entry is not allowed.", "DENIED", vehicle?.id, vehicle?.companyId, ownerVehicle?.id);
    }

    if (enter) {
      const [companyVehicleInside, companyVisitorInside, ownerInside, adminVisitorInside, building] = await Promise.all([
        tx.vehicle.count({ where: { isInside: true, company: { buildingId: reader.buildingId } } }),
        tx.visitor.count({ where: { buildingId: reader.buildingId, companyId: { not: null }, isInside: true } }),
        tx.buildingOwnerVehicle.count({ where: { buildingId: reader.buildingId, isInside: true } }),
        tx.visitor.count({ where: { buildingId: reader.buildingId, companyId: null, isInside: true } }),
        tx.building.findUniqueOrThrow({
          where: { id: reader.buildingId },
          select: { companyParking: true, ownerParking: true, totalParking: true },
        }),
      ]);
      const companyInsideTotal = companyVehicleInside + companyVisitorInside;
      const totalInside = companyInsideTotal + ownerInside + adminVisitorInside;

      if (ownerVehicle) {
        if (ownerInside >= building.ownerParking || totalInside >= building.totalParking) {
          return record(READER_NO_SUCCESS_CODE, "Owner Parking allocation is full", "DENIED", undefined, undefined, ownerVehicle.id);
        }
      } else {
        const isCompanyOwner = vehicle!.employee.category === "OWNER";
        const categoryInside = await tx.vehicle.count({
          where: {
            companyId: vehicle!.companyId,
            isInside: true,
            employee: { category: isCompanyOwner ? "OWNER" : { not: "OWNER" } },
          },
        });
        const categoryLimit = isCompanyOwner
          ? vehicle!.company.ownerParkingAllocation
          : vehicle!.company.employeeParkingAllocation;

        if (
          categoryInside >= categoryLimit ||
          companyInsideTotal >= building.companyParking ||
          totalInside >= building.totalParking
        ) {
          return record(
            READER_NO_SUCCESS_CODE,
            isCompanyOwner ? "Company Owner parking allocation is full" : "Employee parking allocation is full",
            "DENIED",
            vehicle!.id,
            vehicle!.companyId,
          );
        }
      }
    }

    if (ownerVehicle) {
      await tx.buildingOwnerVehicle.update({
        where: { id: ownerVehicle.id },
        data: { isInside: enter, lastAccessAt: new Date(), lastAccessDevice: reader.deviceNumber },
      });
      return record(
        READER_SUCCESS_CODE,
        enter ? "Owner Parking allowed" : "Owner vehicle checked out",
        enter ? "ENTRY" : "EXIT",
        undefined,
        undefined,
        ownerVehicle.id,
      );
    }

    await tx.vehicle.update({
      where: { id: vehicle!.id },
      data: { isInside: enter, lastAccessAt: new Date(), lastAccessDevice: reader.deviceNumber },
    });
    return record(
      READER_SUCCESS_CODE,
      enter ? "Parking allowed" : "Vehicle checked out",
      enter ? "ENTRY" : "EXIT",
      vehicle!.id,
      vehicle!.companyId,
    );
  }, RFID_TRANSACTION);
}

export async function consumeCardEnrollment(tx: Prisma.TransactionClient, input: {
  enrollmentId: string; ownerId: string; companyId: string; employeeId: string; buildingId: string; vehicleId?: string;
}) {
  const building = await tx.building.findUnique({ where: { id: input.buildingId }, select: { enabled: true } });
  if (!building?.enabled) throw new ParkingError("Building is disabled. Card registration is unavailable.", 403);
  const enrollment = await tx.rfidEnrollment.findUnique({ where: { id: input.enrollmentId }, include: { reader: true } });
  if (!enrollment || enrollment.ownerParking || enrollment.ownerId !== input.ownerId || enrollment.companyId !== input.companyId ||
    enrollment.employeeId !== input.employeeId || enrollment.vehicleId !== (input.vehicleId || null)) {
    throw new ParkingError("This card registration does not belong to this vehicle form.", 403);
  }
  if (enrollment.status !== "CAPTURED" || !enrollment.cardNo || enrollment.expiresAt <= new Date()) {
    throw new ParkingError("Scan a card again before saving this registration.", 409);
  }
  if (!enrollment.reader.enabled || enrollment.reader.mode !== "REGISTER" || enrollment.reader.buildingId !== input.buildingId) {
    throw new ParkingError("The registration reader is no longer available.", 409);
  }
  const [assigned, assignedOwner] = await Promise.all([
    tx.vehicle.findUnique({ where: { rfidCardNo: enrollment.cardNo }, select: { id: true } }),
    tx.buildingOwnerVehicle.findUnique({ where: { rfidCardNo: enrollment.cardNo }, select: { id: true } }),
  ]);
  if ((assigned && assigned.id !== input.vehicleId) || assignedOwner) {
    throw new ParkingError("This RFID card is already assigned to another vehicle.", 409);
  }
  await tx.rfidEnrollment.update({ where: { id: enrollment.id }, data: { status: "COMPLETED" } });
  return enrollment;
}
