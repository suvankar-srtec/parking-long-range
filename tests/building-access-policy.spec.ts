import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { createHmac, randomBytes } from "node:crypto";
loadEnvConfig(process.cwd());
const prisma = new PrismaClient({ log: [] });
test.afterAll(async () => { await prisma.$disconnect(); });
function token(id: string) {
  const encoded = Buffer.from(JSON.stringify({ userDbId: id, exp: Math.floor(Date.now()/1000)+900 })).toString("base64url");
  return encoded + "." + createHmac("sha256", process.env.SESSION_SECRET!).update(encoded).digest("base64url");
}
test("Admin and Super Admin can independently save building access settings", async ({ page, context, baseURL }) => {
  test.setTimeout(180000);
  const tag = "ACCESS-POLICY-TEST-" + randomBytes(8).toString("hex");
  let buildingId = "";
  const users: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const owner = await prisma.user.create({ data: { userId: tag+"-sa", username: tag, role: "SUPER_ADMIN" } }); users.push(owner.id);
    const building = await prisma.building.create({ data: { name: tag, superAdminId: owner.id, totalParking: 4, ownerParking: 4, companyParking: 0 } }); buildingId=building.id;
    const admin = await prisma.user.create({ data: { userId: tag+"-admin", username: tag, role: "BUILDING_ADMIN", buildingId } }); users.push(admin.id);
    for (const user of [owner,admin]) {
      await context.clearCookies();
      await context.addCookies([{ name:"parking_session", value:token(user.id), url:baseURL! }]);
      await page.goto(user.id===owner.id ? `/dashboard/buildings/${buildingId}` : "/dashboard/parking-allocation");
      await expect(page.getByRole("form",{name:"Building access settings"})).toHaveCount(0);
      const nav=page.getByRole("navigation",{name:"Main navigation"});
      const order=await nav.locator(":scope > a, :scope > div > button").allTextContents();
      expect(order.findIndex(text=>text.includes("Notifications"))).toBeGreaterThan(order.findIndex(text=>text.includes("Access Control")));
      await nav.getByRole("button",{name:"Settings",exact:true}).click();
      await nav.getByRole("link",{name:"Limit enable/disable"}).click();
      await expect(page.getByRole("heading",{name:"Limit enable/disable",exact:true})).toBeVisible();
      if(user.id===owner.id) {
        await page.getByLabel("Building",{exact:true}).selectOption(buildingId);
        await page.getByRole("button",{name:"Open building"}).click();
      }
      const form=page.getByRole("form",{name:"Building access settings"});
      await expect(form.getByRole("checkbox",{name:"Parking limits enabled"})).toBeChecked();
      await expect(form.getByRole("checkbox",{name:"Anti-passback enabled"})).toHaveCount(0);
      await form.getByRole("checkbox",{name:"Parking limits enabled"}).uncheck();
      await form.getByRole("button",{name:"Save access settings"}).click();
      await expect.poll(async()=> (await prisma.building.findUniqueOrThrow({where:{id:buildingId}})).parkingLimitsEnabled).toBe(false);
      await page.reload();
      await expect(form.getByRole("checkbox",{name:"Parking limits enabled"})).not.toBeChecked();
      await nav.getByRole("link",{name:"Anti-passback",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Anti-passback",exact:true})).toBeVisible();
      if(user.id===owner.id) {
        await page.getByLabel("Building",{exact:true}).selectOption(buildingId);
        await page.getByRole("button",{name:"Open building"}).click();
      }
      await expect(form.getByRole("checkbox",{name:"Anti-passback enabled"})).toBeChecked();
      await expect(form.getByRole("checkbox",{name:"Parking limits enabled"})).toHaveCount(0);
      await form.getByRole("checkbox",{name:"Anti-passback enabled"}).uncheck();
      await form.getByRole("button",{name:"Save access settings"}).click();
      await expect.poll(async()=> (await prisma.building.findUniqueOrThrow({where:{id:buildingId}})).antiPassbackEnabled).toBe(false);
      expect((await prisma.building.findUniqueOrThrow({where:{id:buildingId}})).parkingLimitsEnabled).toBe(false);
      await prisma.building.update({where:{id:buildingId},data:{parkingLimitsEnabled:true,antiPassbackEnabled:true}});
    }
    expect(errors).toEqual([]);
  } finally {
    if(buildingId) await prisma.building.delete({where:{id:buildingId}});
    if(users.length) await prisma.user.deleteMany({where:{id:{in:users}}});
  }
});
