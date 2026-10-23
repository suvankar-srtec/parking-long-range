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
    for (const [user, route] of [[owner,`/dashboard/buildings/${buildingId}`],[admin,"/dashboard/parking-allocation"]] as const) {
      await context.clearCookies();
      await context.addCookies([{ name:"parking_session", value:token(user.id), url:baseURL! }]);
      await page.goto(route);
      const form=page.getByRole("form",{name:"Building access settings"});
      await expect(form).toBeVisible();
      await expect(form.getByRole("checkbox",{name:"Parking limits enabled"})).toBeChecked();
      await expect(form.getByRole("checkbox",{name:"Anti-passback enabled"})).toBeChecked();
      await form.getByRole("checkbox",{name:"Parking limits enabled"}).uncheck();
      await form.getByRole("button",{name:"Save access settings"}).click();
      await expect.poll(async()=> (await prisma.building.findUniqueOrThrow({where:{id:buildingId}})).parkingLimitsEnabled).toBe(false);
      await page.reload();
      await expect(form.getByRole("checkbox",{name:"Parking limits enabled"})).not.toBeChecked();
      await expect(form.getByRole("checkbox",{name:"Anti-passback enabled"})).toBeChecked();
      await form.getByRole("checkbox",{name:"Anti-passback enabled"}).uncheck();
      await form.getByRole("button",{name:"Save access settings"}).click();
      await expect.poll(async()=> (await prisma.building.findUniqueOrThrow({where:{id:buildingId}})).antiPassbackEnabled).toBe(false);
      await form.getByRole("checkbox",{name:"Parking limits enabled"}).check();
      await form.getByRole("checkbox",{name:"Anti-passback enabled"}).check();
      await form.getByRole("button",{name:"Save access settings"}).click();
      await expect.poll(async()=> {const b=await prisma.building.findUniqueOrThrow({where:{id:buildingId}});return b.parkingLimitsEnabled&&b.antiPassbackEnabled;}).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    if(buildingId) await prisma.building.delete({where:{id:buildingId}});
    if(users.length) await prisma.user.deleteMany({where:{id:{in:users}}});
  }
});
