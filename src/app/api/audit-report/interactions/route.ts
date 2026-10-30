import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { auditPage, interfaceActions, type InterfaceAction } from "@/lib/audit-interactions";
export async function POST(request:Request){
 const user=await getCurrentUser();if(!user)return Response.json({message:"Sign in required."},{status:401});
 const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)return Response.json({message:"Invalid origin."},{status:403});
 const raw=await request.text();if(raw.length>16000)return Response.json({message:"Too many interactions."},{status:413});
 let body;try{body=JSON.parse(raw);}catch{return Response.json({message:"Invalid interactions."},{status:400});}
 if(!Array.isArray(body?.events)||!body.events.length||body.events.length>30)return Response.json({message:"Invalid interactions."},{status:400});
 const now=Date.now();const events=[];
 for(const event of body.events){
  if(typeof event?.id!=="string"||!/^[-a-f0-9]{36}$/i.test(event.id)||typeof event.action!=="string"||!Object.hasOwn(interfaceActions,event.action)||typeof event.page!=="string"||event.page.length>300)return Response.json({message:"Invalid interaction."},{status:400});
  const reported=typeof event.at==="string"?Date.parse(event.at):NaN;
  events.push({event_id:event.id,action:interfaceActions[event.action as InterfaceAction],page:auditPage(event.page),occurred_at:new Date(Number.isFinite(reported)&&Math.abs(now-reported)<300000?reported:now).toISOString()});
 }
 let buildingName:string|null=null,superAdminId:string|null=user.role==="SUPER_ADMIN"?user.id:null;
 if(user.buildingId){const building=await prisma.building.findUnique({where:{id:user.buildingId},select:{name:true,superAdminId:true}});buildingName=building?.name??null;superAdminId=building?.superAdminId??null;}
 // Client clicks describe interaction only; access decisions are audited independently.
 await prisma.$executeRaw`INSERT INTO audit_records(source,category,action,"entityType","entityId",actor,"actorRole","buildingId","buildingName","superAdminId",result,"occurredAt",details)
 SELECT 'Interface','Activity',event.action,'ui_interaction',event.event_id,${user.userId},${user.role},${user.buildingId},${buildingName},${superAdminId},'Clicked',event.occurred_at::timestamptz,jsonb_build_object('page',event.page)
 FROM jsonb_to_recordset(${JSON.stringify(events)}::jsonb) AS event(event_id text,action text,page text,occurred_at text)
 ON CONFLICT DO NOTHING`;
 return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
}
