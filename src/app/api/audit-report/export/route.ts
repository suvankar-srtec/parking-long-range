import { getCurrentUser } from "@/lib/session";
import { readAudit } from "@/lib/audit-report";
import { withAuditRequest } from "@/lib/audit-request";
function cell(value: unknown) { const text=String(value ?? ""); return '"'+(/^[\s]*[=+@-]/.test(text) ? "'"+text : text).replaceAll('"','""')+'"'; }
async function exportAudit(request: Request) {
 const user=await getCurrentUser();
 if (!user || user.role !== "SUPER_ADMIN") return Response.json({message:"Super Admin access required."},{status:user?403:401});
 const params=new URL(request.url).searchParams; params.delete("before");
 const rows=await readAudit(user,params,10001);
 if (rows.length>10000) return Response.json({message:"Narrow the date range to export at most 10,000 records."},{status:400});
 const fields=["id","occurredAt","recordedAt","category","action","actor","actorRole","buildingName","companyName","entityType","entityId","result","source","eventType"] as const;
 const csv=[fields.map(cell).join(","),...rows.map(row=>fields.map(key=>cell(row[key])).join(","))].join("\r\n");
 return new Response("\ufeff"+csv,{headers:{"Content-Type":"text/csv;charset=utf-8","Content-Disposition":'attachment; filename="audit-report.csv"',"Cache-Control":"no-store"}});
}
export const GET=withAuditRequest(exportAudit);
