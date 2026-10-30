import test from "node:test";
import assert from "node:assert/strict";
import { auditMenu, interactionMenu, interactionDescription, auditPage } from "../src/lib/audit-interactions.ts";
test("button clicks show their current menu and submenu",()=>{
 assert.equal(interactionMenu("Clicked Save access settings","/settings/anti-passback","BUILDING_ADMIN"),"Settings › Anti-passback");
 assert.equal(auditMenu("/access-control/register-cards/private-company"),"Access Control > Register cards");
 assert.equal(auditMenu("/dashboard/buildings/private-building"),"Dashboard > Buildings");
});
test("navigation clicks show the destination menu, not the previous screen",()=>{
 assert.equal(interactionMenu("Opened Reports","/audit-report"),"Reports");
 assert.equal(interactionMenu("Opened Gate Details","/dashboard"),"Access Control › Gate Details");
});
test("dashboard context follows account role without personal values",()=>{
 assert.equal(auditMenu("/dashboard","EMPLOYEE"),"Dashboard > Real Time Monitor");
 assert.equal(auditMenu("/dashboard","BUILDING_ADMIN"),"Dashboard > My building");
 assert.equal(auditMenu("/dashboard","SUPER_ADMIN"),"Dashboard > Buildings");
 assert.equal(auditPage("/dashboard/buildings/private-id?password=private"),"/dashboard/buildings/[item]");
});

test("click trails put the menu before the action and do not invent older actions",()=>{
 assert.equal(interactionDescription("Clicked Save access settings","/settings/anti-passback","BUILDING_ADMIN"),"Click > Settings > Anti-passback > Save access settings");
 assert.equal(interactionDescription("Opened Reports","/audit-report"),"Click > Reports > Open Reports");
 assert.equal(interactionDescription("Clicked a button","/dashboard/buildings/[item]"),"Click > Dashboard > Buildings > Action not recorded");
});
