import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Count occupancy transitions, including the last known state before the day. */
export async function dailyMovements(buildingId: string, companyId: string | null, start: Date, end: Date) {
  const rows = await prisma.$queryRaw<Array<{ totalIn: bigint; totalOut: bigint; openingOnSite: bigint }>>(Prisma.sql`
    WITH history AS (
      SELECT "id", "createdAt", "action",
        COALESCE('owner:' || "ownerVehicleId", 'vehicle:' || "vehicleId", 'visitor:' || "visitorId", 'card:' || "cardNo") AS identity
      FROM "rfid_events"
      WHERE "buildingId" = ${buildingId}
        ${companyId ? Prisma.sql`AND "companyId" = ${companyId}` : Prisma.empty}
        AND "action" IN ('ENTRY', 'EXIT') AND "code" = '0000' AND "createdAt" < ${end}
    ), ordered AS (
      SELECT *,
        LAG("action") OVER (PARTITION BY identity ORDER BY "createdAt", "id") AS previous,
        LEAD("createdAt") OVER (PARTITION BY identity ORDER BY "createdAt", "id") AS next_time
      FROM history
    )
    SELECT
      COUNT(*) FILTER (WHERE "createdAt" >= ${start} AND "action" = 'ENTRY' AND previous IS DISTINCT FROM "action") AS "totalIn",
      COUNT(*) FILTER (WHERE "createdAt" >= ${start} AND "action" = 'EXIT' AND previous IS DISTINCT FROM "action") AS "totalOut",
      COUNT(*) FILTER (WHERE "createdAt" < ${start} AND "action" = 'ENTRY' AND (next_time >= ${start} OR next_time IS NULL))
        + COUNT(*) FILTER (WHERE "createdAt" >= ${start} AND previous IS NULL AND "action" = 'EXIT') AS "openingOnSite"
    FROM ordered
  `);
  const row = rows[0];
  return { totalIn: Number(row?.totalIn ?? 0), totalOut: Number(row?.totalOut ?? 0), openingOnSite: Number(row?.openingOnSite ?? 0) };
}
