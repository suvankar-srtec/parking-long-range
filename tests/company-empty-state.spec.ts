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
test("First-company action stays visible for Super Admin and authorized Admin", async ({ page, context, baseURL }) => {
  test.setTimeout(180000);
  const tag = "EMPTY-COMPANY-" + randomBytes(8).toString("hex");
  const users: string[] = [];
  const companies: string[] = [];
  let buildingId = "";
  try {
    const owner = await prisma.user.create({ data: { userId: tag+"-sa", username: tag, role: "SUPER_ADMIN" } }); users.push(owner.id);
    const building = await prisma.building.create({ data: { name: tag, superAdminId: owner.id, totalParking: 10, ownerParking: 0, companyParking: 10 } }); buildingId=building.id;
    const admin = await prisma.user.create({ data: { userId: tag+"-admin", username: tag, role: "BUILDING_ADMIN", buildingId } }); users.push(admin.id);
    const restricted = await prisma.user.create({ data: { userId: tag+"-restricted", username: tag, role: "BUILDING_ADMIN", buildingId, permissionsCustomized: true, permissions: [] } }); users.push(restricted.id);
    for (const user of [owner, admin, restricted]) {
      await context.clearCookies();
      await context.addCookies([{name:"parking_session",value:token(user.id),url:baseURL!}]);
      await page.goto(user.id === owner.id ? `/dashboard/buildings/${buildingId}` : "/dashboard");
      await expect(page.getByText("No companies created yet.", {exact:true})).toBeVisible();
      if (user.id === restricted.id) {
        await expect(page.getByRole("button",{name:"New company"})).toHaveCount(0);
      } else {
        await page.getByRole("button",{name:"New company"}).click();
        await expect(page.getByRole("dialog",{name:"Create new company"})).toBeVisible();
        const dialog=page.getByRole("dialog",{name:"Create new company"});
        const reservation=page.waitForResponse(response=>response.url().endsWith("/api/user-ids") && response.request().postDataJSON()?.name===tag+user.role);
        await dialog.getByLabel("Company name",{exact:false}).fill(tag+user.role);
        expect((await reservation).status()).toBe(200);
        await dialog.getByLabel("Password",{exact:true}).fill(randomBytes(16).toString("hex"));
        await expect(dialog.getByLabel("Generated User ID")).toHaveValue(/^COMP[0-9]+$/);
        const created=page.waitForResponse(response=>response.url().endsWith(`/api/buildings/${buildingId}/companies`) && response.request().method()==="POST");
        await dialog.getByRole("button",{name:"Create company",exact:true}).click();
        const response=await created;
        expect(response.status()).toBe(201);
        const data=await response.json(); companies.push(data.company.id);
        await expect(dialog).not.toBeVisible();
        expect(await prisma.company.count({where:{id:data.company.id,buildingId}})).toBe(1);
        await prisma.entityIdentity.deleteMany({where:{entityId:data.company.id}});
        await prisma.company.delete({where:{id:data.company.id}});
      }
    }
  } finally {
    if(companies.length) await prisma.entityIdentity.deleteMany({where:{entityId:{in:companies}}});
    await prisma.userIdReservation.deleteMany({where:{ownerId:{in:users}}});
    if(buildingId) await prisma.building.delete({where:{id:buildingId}});
    if(users.length) await prisma.user.deleteMany({where:{id:{in:users}}});
  }
});
