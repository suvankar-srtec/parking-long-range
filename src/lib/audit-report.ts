import { auditCardActionsCte } from "@/lib/audit-card-actions";
import { interactionDescription } from "@/lib/audit-interactions";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimarySuperAdmin } from "@/lib/super-admin-scope";
import type { getCurrentUser } from "@/lib/session";
export type AuditRow = { id: string; recordedAt: string; occurredAt: string; source: string; category: string; action: string; entityType: string | null; entityId: string | null; buildingName: string | null; companyName: string | null; actor: string; actorRole: string | null; result: string; eventType: string | null };
export const auditCategories = ["Access scans","Card management","Login and security","Accounts and permissions","Account actions","Buildings and companies","Employees and vehicles","Card registration","Devices and gates","Manual exits","Report exports","Activity","Interface activity"];
export async function readAudit(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, params: URLSearchParams, limit: number | null = 51): Promise<AuditRow[]> {
 const filters: Prisma.Sql[] = [Prisma.sql`result <> 'Started'`];
 if (!isPrimarySuperAdmin(user)) filters.push(Prisma.sql`"superAdminId" = ${user.id}`);
 const search = (params.get("search") ?? "").trim().slice(0,150);
 if (search) { const pattern = "%" + search.replace(/[\\%_]/g,"\\$&") + "%";
 filters.push(Prisma.sql`concat_ws(' ',actor,"actorRole",category,action,"entityType","entityId","buildingName","companyName",result) ILIKE ${pattern}`); }
 const category = params.get("category"); if(category === "Activity") filters.push(Prisma.sql`category IN ('Activity','Interface activity')`); else if (category && auditCategories.includes(category)) filters.push(Prisma.sql`category = ${category}`);
 for (const [key, op] of [["from",">="],["to","<"]] as const) {
  const value = params.get(key); if (!value) continue;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date.");
  const date = new Date(value + "T00:00:00+05:30"); if (!Number.isFinite(date.getTime())) throw new Error("Invalid date.");
  if (key === "to") date.setTime(date.getTime()+86400000);
  filters.push(op === ">=" ? Prisma.sql`"occurredAt" >= ${date}` : Prisma.sql`"occurredAt" < ${date}`);
 }
 const before = params.get("before"); if (before) { if (!/^\d{1,19}$/.test(before)) throw new Error("Invalid page."); filters.push(Prisma.sql`id < ${BigInt(before)}`); }
 const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters," AND ")}` : Prisma.empty;
 const limitClause = limit === null ? Prisma.empty : Prisma.sql`LIMIT ${limit}`;
 const rows = await prisma.$queryRaw<Array<Omit<AuditRow,"recordedAt"|"occurredAt"> & {recordedAt: Date; occurredAt: Date; activityPage: string | null}>>`${auditCardActionsCte} SELECT id::text,"recordedAt","occurredAt",source,category,action,CASE WHEN source='Interface' THEN details->>'page' ELSE NULL END AS "activityPage","entityType","entityId","buildingName","companyName",actor,"actorRole",result,CASE WHEN category='Card management' THEN 'Manual' WHEN "entityType"='rfid_events' THEN CASE WHEN details #>> '{after,deviceNumber}'='MANUAL' THEN 'Manual' WHEN details #>> '{after,id}' LIKE 'cloudc-history-%' THEN 'Offline' ELSE 'Online' END ELSE NULL END AS "eventType" FROM audit_display AS audit_records ${where} ORDER BY audit_records.id DESC ${limitClause}`;
 return rows.map(({activityPage,...row})=>({...row,
  category:row.category==="Interface activity"?"Activity":row.category,
  action:row.source==="Interface"?interactionDescription(row.action,activityPage||"/",row.actorRole):row.action,
  recordedAt:row.recordedAt.toISOString(),occurredAt:row.occurredAt.toISOString()}));
}
