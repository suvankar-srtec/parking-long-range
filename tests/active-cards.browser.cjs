// Local browser verification. All manual-exit writes are intercepted; no live cards are changed.
const { PrismaClient } = require("@prisma/client");
const { createHmac } = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
process.loadEnvFile(".env");
const prisma = new PrismaClient();
(async () => {
  const building = await prisma.building.findFirst({ where: { readers: { some: { deviceNumber: "80M236-A" } } } });
  if (!building) throw Error("Test building missing");
  const users = await prisma.user.findMany({ where: { OR: [{ id: building.superAdminId }, { role: "BUILDING_ADMIN", buildingId: building.id }, { userId: "SUP01", buildingId: building.id }] }, select: { id: true, role: true, userId: true } });
  if (users.length < 3) throw Error("All three test roles are required");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const user of users) {
      const supervisor = user.userId === "SUP01";
      const context = await browser.newContext();
      const payload = Buffer.from(JSON.stringify({ userDbId: user.id, exp: Math.floor(Date.now()/1000)+300 })).toString("base64url");
      await context.addCookies([{ name: "parking_session", value: payload + "." + createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url"), url: "http://localhost:3000" }]);
      const page = await context.newPage();
      page.on("dialog", dialog => dialog.accept());
      let cards, calls, failVisitor = false, permitted = true;
      const reset = () => { calls = []; cards = ["vehicle", "owner", "visitor"].map((kind, i) => ({ id: kind+":fixture-"+i, rfidCardNo: "TEST-"+i, vehicleNumber: "FIXTURE-"+i, personName: "Test "+i, personType: ["EMPLOYEE", "OWNER", "VISITOR"][i], companyName: "Test company", department: "Operations", entryTime: new Date().toISOString() })); };
      reset();
      await page.route("**/api/supervisor/headcount?**", route => route.fulfill({ json: { ok: true, buildingName: "Test building", totalIn: 3, totalOut: 0, totalOnSite: cards.length, activeCards: cards, canManualExit: permitted, recentEvents: [], departments: [], employeeParkingByCompany: [], updatedAt: new Date().toISOString() } }));
      await page.route("**/api/supervisor/manual-exit", async route => {
        const { id } = route.request().postDataJSON(); calls.push(id);
        if (failVisitor && id.startsWith("visitor:")) return route.fulfill({ status: 403, json: { ok: false, message: "Fixture denied" } });
        if (!supervisor) cards = cards.filter(card => card.id !== id);
        await route.fulfill({ json: { ok: true, requested: supervisor } });
      });
      const url = "http://localhost:3000" + (supervisor ? "/dashboard" : "/access-control/activity");
      await page.goto(url);
      await page.getByRole("button", { name: /Total On Site/ }).click();
      const modal = page.getByRole("dialog", { name: "Active RFID and visitor QR entries" });
      await modal.getByRole("checkbox", { name: "Select all active cards" }).check();
      await expect(modal.getByRole("button", { name: "Remove selected (3)", exact: true })).toBeEnabled();
      await modal.getByRole("checkbox", { name: "Select FIXTURE-2", exact: true }).uncheck();
      await expect(modal.getByRole("button", { name: "Remove selected (2)", exact: true })).toBeEnabled();
      if (!await modal.getByRole("checkbox", { name: "Select all active cards" }).evaluate(element => element.indeterminate)) throw Error("Partial selection not reflected");
      await modal.getByRole("checkbox", { name: "Select all active cards" }).check();
      await modal.getByRole("button", { name: "Remove selected (3)", exact: true }).click();
      await expect.poll(() => calls.length).toBe(3);
      if (new Set(calls).size !== 3) throw Error("Duplicate bulk requests");
      await expect(modal.getByRole("button", { name: "Remove selected (0)", exact: true })).toBeDisabled();
      if (supervisor && cards.length !== 3) throw Error("Supervisor must not change occupancy");
      if (!supervisor && cards.length !== 0) throw Error("Admin exits incomplete");
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      if (user.role === "BUILDING_ADMIN") {
        reset(); failVisitor = true;
        await page.reload(); await page.getByRole("button", { name: /Total On Site/ }).click();
        await modal.getByRole("checkbox", { name: "Select all active cards" }).check();
        await modal.getByRole("button", { name: "Remove selected (3)", exact: true }).click();
        await expect(modal.getByRole("checkbox", { name: "Select FIXTURE-2", exact: true })).toBeChecked();
        await expect(modal.getByRole("button", { name: "Remove selected (1)", exact: true })).toBeEnabled();
        await page.keyboard.press("Escape");
        permitted = false; reset(); await page.reload(); await page.getByRole("button", { name: /Total On Site/ }).click();
        await expect(modal.getByRole("checkbox")).toHaveCount(0);
        await expect(modal.getByRole("button", { name: /Remove/ })).toHaveCount(0);
      }
      console.log((supervisor ? "Supervisor" : user.role) + ": selection, bulk requests, permissions and dialog verified");
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
