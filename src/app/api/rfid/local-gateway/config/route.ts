import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeLocalGateway } from "@/lib/local-gateway";
import { rfidApiError } from "@/lib/rfid-access";
import { ParkingError } from "@/lib/building-parking";
import { parseGateConfig, gateReaderDirection } from "@/lib/gate-config";
export async function GET(request: Request) {
 try {
  const { serial } = await authorizeLocalGateway(request);
  const readers = await prisma.rfidReader.findMany({ where: { deviceNumber: { in: [serial + "-A", serial + "-B"] }, readerProtocol: "CLOUD_C" }, include: { building: { include: { gates: true } } } });
  const building = readers[0]?.building;
  if (readers.length !== 2 || !building || readers.some(r => !r.enabled || r.buildingId !== building.id)) throw new ParkingError("Assign both controller inputs to one building.", 409);
  const [owners, vehicles, visitors, companies] = await Promise.all([
    prisma.buildingOwnerVehicle.findMany({ where: { buildingId: building.id } }),
    prisma.vehicle.findMany({ where: { company: { buildingId: building.id } }, include: { company: true, employee: true } }),
    prisma.visitor.findMany({ where: { buildingId: building.id, isInside: true }, select: { companyId: true } }),
    prisma.company.findMany({ where: { buildingId: building.id }, select: { id: true, enabled: true, ownerParkingAllocation: true, employeeParkingAllocation: true } }),
  ]);
  const cards = [
    ...owners.map(r => ({ cardNo: r.rfidCardNo, pool: "owner", category: "OWNER", companyId: null, allowed: building.enabled && !r.rfidBlocked, isInside: r.isInside, lastAccessAt: r.lastAccessAt })),
    ...vehicles.map(r => ({ cardNo: r.rfidCardNo, pool: "company", category: r.employee.category === "OWNER" ? "OWNER" : "EMPLOYEE", companyId: r.companyId, allowed: building.enabled && r.company.enabled && !r.employee.isPlaceholder && !r.rfidBlocked, isInside: r.isInside, lastAccessAt: r.lastAccessAt })),
  ].filter(r => r.cardNo && /^[1-9][0-9]{0,9}$/.test(r.cardNo));
  const directions = Object.fromEntries(readers.map(r => {
    const gate = building.gates.map(g => parseGateConfig(g.direction)).find(g => g.entryReaderId === r.id || g.exitReaderId === r.id);
    return [r.deviceNumber.endsWith("-A") ? "0" : "1", r.mode === "REGISTER" ? "REGISTER" : !gate ? "DISABLED" : gateReaderDirection(gate, r.id)];
  }));
  return NextResponse.json({ ok: true, serial, buildingId: building.id, directions, cards,
    parkingLimitsEnabled: building.parkingLimitsEnabled, antiPassbackEnabled: building.antiPassbackEnabled,
    limits: { total: building.totalParking, owner: building.ownerParking, company: building.companyParking },
    visitorInside: visitors.length, companyVisitorInside: visitors.filter(v => v.companyId).length,
    companies, leaseUntil: new Date(Date.now() + 86400000).toISOString() }, { headers: { "Cache-Control": "no-store" } });
 } catch (error) { return rfidApiError(error); }
}
