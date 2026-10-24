import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { createHmac, randomBytes } from "node:crypto";
loadEnvConfig(process.cwd());
const prisma = new PrismaClient({log:[]});
test.afterAll(async()=>{await prisma.$disconnect();});
test("Employee edit stays compact and saves name and department without changing identity",async({page,context,baseURL})=>{
  test.setTimeout(180000);page.setDefaultTimeout(15000);
  const tag="EMPLOYEE-EDIT-"+randomBytes(8).toString("hex");let buildingId="",userId="";
  try {
    const b=await prisma.building.create({data:{name:tag,totalParking:10,ownerParking:0,companyParking:10}});buildingId=b.id;
    const c=await prisma.company.create({data:{name:tag,buildingId,parkingAllocation:10}});
    await prisma.companyDepartment.createMany({data:[{companyId:c.id,name:"Sales"},{companyId:c.id,name:"Engineering"}]});
    const employee=await prisma.employee.create({data:{companyId:c.id,name:"Original Employee",userId:tag+"-person",department:"Sales",parkingLimit:1}});
    const u=await prisma.user.create({data:{userId:tag,username:tag,role:"COMPANY_ADMIN",companyId:c.id,buildingId}});userId=u.id;
    const encoded=Buffer.from(JSON.stringify({userDbId:u.id,exp:Math.floor(Date.now()/1000)+900})).toString("base64url");
    const cookie=encoded+"."+createHmac("sha256",process.env.SESSION_SECRET!).update(encoded).digest("base64url");
    await context.addCookies([{name:"parking_session",value:cookie,url:baseURL!}]);
    await page.goto("/dashboard");await page.getByRole("button",{name:"Edit",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Edit employee",exact:true});
    await expect(dialog.getByLabel("User ID",{exact:true})).toHaveValue(employee.userId);
    await expect(dialog.getByLabel("User ID",{exact:true})).toHaveAttribute("readonly","");
    await dialog.getByRole("combobox",{name:"Department",exact:true}).selectOption("Engineering");
    for(const size of [{width:1366,height:600},{width:1024,height:768},{width:390,height:700}]) {
      await page.setViewportSize(size);
      const dimensions=await dialog.evaluate(element=>({scroll:element.scrollHeight-element.clientHeight,bottom:element.getBoundingClientRect().bottom,height:window.innerHeight}));
      expect(dimensions.scroll).toBeLessThanOrEqual(1);expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.height);
      await expect(dialog.getByRole("button",{name:"Save changes",exact:true})).toBeInViewport();
    }
    await dialog.getByLabel("Name",{exact:true}).fill("Updated Employee");
    const saved=page.waitForResponse(r=>r.url().endsWith(`/api/companies/${c.id}/employees/${employee.id}`)&&r.request().method()==="PATCH",{timeout:35000});
    await dialog.getByRole("button",{name:"Save changes",exact:true}).click();expect((await saved).status()).toBe(200);
    await expect(dialog).not.toBeVisible();
    const updated=await prisma.employee.findUniqueOrThrow({where:{id:employee.id}});
    expect(updated.name).toBe("Updated Employee");expect(updated.department).toBe("Engineering");expect(updated.userId).toBe(employee.userId);expect(updated.parkingLimit).toBe(1);
  } finally {
    if(buildingId) await prisma.building.delete({where:{id:buildingId}});
    if(userId) await prisma.user.deleteMany({where:{id:userId}});
  }
});
