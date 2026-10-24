import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { createHmac, randomBytes } from "node:crypto";
loadEnvConfig(process.cwd());
const prisma = new PrismaClient({log:[]});
test.afterAll(async()=>{await prisma.$disconnect();});
function token(id:string) {
  const encoded=Buffer.from(JSON.stringify({userDbId:id,exp:Math.floor(Date.now()/1000)+900})).toString("base64url");
  return encoded+"."+createHmac("sha256",process.env.SESSION_SECRET!).update(encoded).digest("base64url");
}
test("Company people permission enables scoped employee creation and ID generation",async({page,context,baseURL})=>{
  test.setTimeout(180000);
  const tag="COMPANY-PEOPLE-"+randomBytes(8).toString("hex");
  let buildingId="";const users:string[]=[];
  try {
    const building=await prisma.building.create({data:{name:tag,totalParking:20,ownerParking:0,companyParking:20}});buildingId=building.id;
    const company=await prisma.company.create({data:{name:tag,buildingId,parkingAllocation:10}});
    const other=await prisma.company.create({data:{name:tag+"-other",buildingId,parkingAllocation:10}});
    await prisma.companyDepartment.create({data:{name:"Sales",companyId:company.id}});
    const members=[];
    for(const role of ["COMPANY_ADMIN","BUILDING_OWNER"] as const) {
      const u=await prisma.user.create({data:{userId:tag+role,username:tag,role,buildingId,companyId:company.id,permissionsCustomized:true,permissions:["company.managePeople","company.viewUsage"]}});users.push(u.id);members.push(u);
    }
    const restricted=await prisma.user.create({data:{userId:tag+"restricted",username:tag,role:"COMPANY_ADMIN",buildingId,companyId:company.id,permissionsCustomized:true,permissions:["company.viewUsage"]}});users.push(restricted.id);
    for(const user of [...members,restricted]) {
      await context.clearCookies();await context.addCookies([{name:"parking_session",value:token(user.id),url:baseURL!}]);
      await page.goto("/dashboard");
      if(user.id===restricted.id) {
        await expect(page.getByRole("button",{name:"Add Employee",exact:true})).toHaveCount(0);
        const denied=await context.request.post(`/api/companies/${company.id}/employees`,{data:{name:"Denied"}});expect(denied.status()).toBe(403);
        expect((await context.request.post("/api/user-ids",{data:{kind:"employee",scopeId:company.id,name:"Denied"}})).status()).toBe(403);
        continue;
      }
      expect((await context.request.post("/api/user-ids",{data:{kind:"employee",scopeId:other.id,name:"Wrong scope"}})).status()).toBe(403);
      expect((await context.request.post(`/api/companies/${other.id}/employees`,{data:{name:"Wrong scope"}})).status()).toBe(403);
      await page.getByRole("button",{name:"Add Employee",exact:true}).click();
      const dialog=page.getByRole("dialog",{name:"Add Employee / Company Owner"});
      await expect(dialog.getByLabel("Parking Limit",{exact:true})).toHaveCount(0);
      await dialog.getByLabel("Full Name",{exact:true}).fill(tag+user.role);
      if(user.role==="BUILDING_OWNER") await dialog.getByLabel("Person Type").selectOption("OWNER");
      await expect(dialog.getByLabel("User ID",{exact:true})).toHaveValue(/^EMP\d+$/);
      const created=page.waitForResponse(r=>r.url().endsWith(`/api/companies/${company.id}/employees`)&&r.request().method()==="POST");
      await dialog.getByRole("button",{name:"Add Employee",exact:true}).click();
      const response=await created;expect(response.status()).toBe(201);
      const data=await response.json();expect(data.employee.department).toBe("Sales");expect(data.employee.parkingLimit).toBe(1);
      expect(data.employee.category).toBe(user.role==="BUILDING_OWNER"?"OWNER":"EMPLOYEE");
      await expect(dialog).not.toBeVisible();
      expect(await prisma.employee.count({where:{id:data.employee.id,companyId:company.id}})).toBe(1);
    }
    await context.clearCookies();await context.addCookies([{name:"parking_session",value:token(members[0].id),url:baseURL!}]);
    await prisma.company.update({where:{id:company.id},data:{enabled:false}});
    expect((await context.request.post(`/api/companies/${company.id}/employees`,{data:{name:"Disabled"}})).status()).toBe(403);
    expect((await context.request.post("/api/user-ids",{data:{kind:"employee",scopeId:company.id,name:"Disabled"}})).status()).toBe(403);
  } finally {
    await prisma.userIdReservation.deleteMany({where:{ownerId:{in:users}}});
    if(buildingId) await prisma.building.delete({where:{id:buildingId}});
    if(users.length) await prisma.user.deleteMany({where:{id:{in:users}}});
  }
});
