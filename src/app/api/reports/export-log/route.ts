import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { withAuditRequest } from "@/lib/audit-request";
async function recordExport(request:Request) {
 const user=await getCurrentUser();if(!user)return Response.json({message:"Sign in required."},{status:401});
 const allowed=user.role==="SUPER_ADMIN"||(user.role==="BUILDING_ADMIN"&&hasPermission(user,"building.viewReports"))||((user.role==="COMPANY_ADMIN"||user.role==="BUILDING_OWNER")&&hasPermission(user,"company.viewReports"))||(user.role==="EMPLOYEE"&&hasPermission(user,"supervisor.viewReports"));
 if(!allowed)return Response.json({message:"Report access required."},{status:403});
 const body=await request.json().catch(()=>null);if(!["Excel","PDF"].includes(body?.format))return Response.json({message:"Invalid format."},{status:400});
 return Response.json({ok:true});
}
export const POST=withAuditRequest(recordExport);
