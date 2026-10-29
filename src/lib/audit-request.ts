import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, verifySessionToken } from "@/lib/session";

// Bodies, query strings, response bodies and credentials are never persisted.
export function withAuditRequest<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
 return async (...args: A): Promise<Response> => {
  const request=args[0] instanceof Request?args[0]:null;
  const path=request?new URL(request.url).pathname:"Unknown endpoint";
  const requestId=randomUUID();
  let attemptedUserId: string|null=null, exportFormat: string|null=null;
  if(request && ["/api/login","/api/reports/export-log"].includes(path)) {
   try { const body=await request.clone().json();
    if(path==="/api/login") attemptedUserId=typeof body.userId==="string"?body.userId.trim().slice(0,120):null;
    else exportFormat=["Excel","PDF"].includes(body.format)?body.format:null;
   } catch { /* Invalid requests are recorded by status. */ }
  }
  let user=await getCurrentUser();
  async function write(result:string,status?:number) {
   let buildingName:string|null=null, superAdminId:string|null=user?.role==="SUPER_ADMIN"?user.id:null;
   if(user?.buildingId) {const building=await prisma.building.findUnique({where:{id:user.buildingId},select:{name:true,superAdminId:true}});buildingName=building?.name??null;superAdminId=building?.superAdminId??null;}
   const actor=user?.userId??attemptedUserId??"Unauthenticated";
   const details=JSON.stringify({requestId,method:request?.method,path,status,exportFormat,
    ip:request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0,100)??null,
    userAgent:request?.headers.get("user-agent")?.slice(0,300)??null});
   const category=path.includes("login")||path.includes("logout")?"Login and security":path.includes("export")?"Report exports":"Account actions";
   await prisma.$executeRaw`INSERT INTO audit_records(source,category,action,actor,"actorRole","buildingId","buildingName","superAdminId",result,details)
    VALUES('Application',${category},${path},${actor},${user?.role??null},${user?.buildingId??null},${buildingName},${superAdminId},${result},${details}::jsonb)`;
  }
  // Intent survives a terminated request; mutation never starts without an audit record.
  await write("Started");
  let response:Response;
  try {response=await handler(...args);}catch(error){await write("Failed",500);throw error;}
  if(path==="/api/login" && response.ok) {
   const cookie=response.headers.get("set-cookie")?.match(/parking_session=([^;]+)/)?.[1];
   const session=verifySessionToken(cookie?decodeURIComponent(cookie):null);
   if(session)user=await prisma.user.findUnique({where:{id:session.userDbId}});
  }
  await write(response.status<400?"Success":"Denied / failed",response.status);
  return response;
 };
}
