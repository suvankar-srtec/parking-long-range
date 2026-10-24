import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { createHmac, randomBytes } from "node:crypto";
loadEnvConfig(process.cwd());
const prisma = new PrismaClient({log:[]});
test.afterAll(async()=>{await prisma.$disconnect();});
test("Vehicle form fits desktop and creation popup disappears automatically",async({page,context,baseURL})=>{
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const tag="VEHICLE-LAYOUT-"+randomBytes(8).toString("hex");
  let buildingId="",userId="";
  try {
    const b=await prisma.building.create({data:{name:tag,totalParking:10,ownerParking:0,companyParking:10}});buildingId=b.id;
    const c=await prisma.company.create({data:{name:tag,buildingId,parkingAllocation:10}});
    await prisma.companyDepartment.create({data:{companyId:c.id,name:"Administration"}});
    const u=await prisma.user.create({data:{userId:tag,username:tag,role:"COMPANY_ADMIN",companyId:c.id,buildingId}});userId=u.id;
    const encoded=Buffer.from(JSON.stringify({userDbId:u.id,exp:Math.floor(Date.now()/1000)+900})).toString("base64url");
    const cookie=encoded+"."+createHmac("sha256",process.env.SESSION_SECRET!).update(encoded).digest("base64url");
    await context.addCookies([{name:"parking_session",value:cookie,url:baseURL!}]);
    // Synthetic reader responses exercise layout without operating real hardware.
    await page.route("**/api/rfid/readers",route=>route.fulfill({json:{ok:true,readers:[{id:"layout-reader",name:"Test reader",enabled:true,mode:"REGISTER",buildingId}]}}));
    await page.route("**/api/rfid/enrollments**",route=>route.fulfill({json:{ok:true,enrollment:{id:"layout-enrollment",status:"WAITING",cardNo:null}}}));
    await page.setViewportSize({width:1366,height:600});
    await page.goto("/dashboard");
    await page.getByRole("button",{name:"Add Employee",exact:true}).click();
    let dialog=page.getByRole("dialog",{name:"Add Employee / Company Owner"});
    await dialog.getByLabel("Full Name",{exact:true}).fill("Layout Employee");
    await expect(dialog.getByLabel("User ID",{exact:true})).toHaveValue(/^EMP\d+$/);
    const saved=page.waitForResponse(r=>r.url().endsWith(`/api/companies/${c.id}/employees`) && r.request().method()==="POST",{timeout:35000});
    await dialog.getByRole("button",{name:"Add & Continue",exact:true}).click();
    const savedResponse=await saved;
    expect(await savedResponse.json()).toMatchObject({ok:true});
    const toast=page.getByRole("status").filter({hasText:"Employee created"});
    await expect(toast).toBeVisible();
    dialog=page.getByRole("dialog",{name:"Add vehicle for Layout Employee"});
    await expect(dialog.getByLabel("Plate Number")).toBeVisible();
    await expect(dialog.getByText("PERSON CREATED",{exact:true})).toHaveCount(0);
    await dialog.getByRole("combobox",{name:/Registration reader/}).selectOption("layout-reader");
    await expect(dialog.getByText(/Scan the RFID card on Test reader/)).toBeVisible();
    for(const size of [{width:1366,height:600},{width:1366,height:768},{width:1024,height:768}]) {
      await page.setViewportSize(size);
      const layout=await dialog.evaluate(element=>{
        const form=element.querySelector(".employee-vehicle-step")!;
        const box=element.getBoundingClientRect();
        return{scroll:form.scrollHeight-form.clientHeight,top:box.top,bottom:box.bottom,height:window.innerHeight};
      });
      if(size.height===600) await page.screenshot({path:"test-results/employee-vehicle-layout.png"});
      expect(layout.scroll).toBeLessThanOrEqual(1);
      expect(layout.top).toBeGreaterThanOrEqual(0);
      expect(layout.bottom).toBeLessThanOrEqual(layout.height);
      await expect(dialog.getByRole("button",{name:"Register vehicle",exact:true})).toBeInViewport();
    }
    await expect(toast).toHaveCount(0,{timeout:6500});
    await page.setViewportSize({width:390,height:700});
    await expect(dialog.getByLabel("Plate Number")).toBeVisible();
    await expect(dialog.getByRole("button",{name:"Finish without vehicle"})).toBeVisible();
    await dialog.getByRole("button",{name:"Finish without vehicle"}).click();
    await expect(dialog).not.toBeVisible();
  } finally {
    if(userId) await prisma.userIdReservation.deleteMany({where:{ownerId:userId}});
    if(buildingId) await prisma.building.delete({where:{id:buildingId}});
    if(userId) await prisma.user.deleteMany({where:{id:userId}});
  }
});
