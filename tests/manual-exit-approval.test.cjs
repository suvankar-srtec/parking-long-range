const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript");
function fixture(){
 const state={user:{id:"supervisor",userId:"sup",username:"Supervisor",role:"EMPLOYEE",buildingId:"building"},target:{id:"v",buildingId:"building",isInside:true,rfidCardNo:"123",plateNumber:"P1",ownerName:"Owner"},notices:[],events:[],reads:[],failCreate:false};
 class ParkingError extends Error{constructor(message,status=400){super(message);this.status=status;}}
 const matches=(row,where)=> (!where.id||row.id===where.id)&&(!where.buildingId||(typeof where.buildingId==="string"?where.buildingId===row.buildingId:where.buildingId.in.includes(row.buildingId)))&&(!where.status||row.status===where.status)&&(!where.targetId||row.targetId===where.targetId);
 const tx={buildingOwnerVehicle:{findUnique:async({where})=>where.id===state.target.id?{...state.target}:null,update:async({data})=>Object.assign(state.target,data)},
  building:{findUniqueOrThrow:async()=>({name:"Building"}),findFirst:async()=>({id:"building"})},
  rfidEvent:{create:async({data})=>{const event={id:"e"+state.events.length,...data};state.events.push(event);return event;}},
  manualExitNotification:{findFirst:async({where})=>state.notices.find(n=>matches(n,where))||null,create:async({data})=>{if(state.failCreate)throw new ParkingError("Storage failed",500);const notice={id:"n"+state.notices.length,status:"PENDING",...data};state.notices.push(notice);return notice;},update:async({where,data})=>Object.assign(state.notices.find(n=>n.id===where.id),data)},
  manualExitNotificationRead:{createMany:async({data})=>state.reads.push(...data)},
 };
 let queue=Promise.resolve();const prisma={$transaction:fn=>{const next=queue.then(()=>fn(tx));queue=next.catch(()=>{});return next;}};
 const cache={};function load(file){
  if(cache[file])return cache[file];const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,Date,console,require(id){
   if(id==="next/server")return{NextResponse:{json:(body,init)=>Response.json(body,init)}};
   if(id==="@/lib/prisma")return{prisma};if(id==="@/lib/session")return{getCurrentUser:async()=>state.user};
   if(id==="@/lib/permissions")return{hasPermission:()=>true};if(id==="@/lib/super-admin-scope")return{isPrimarySuperAdmin:()=>true};
   if(id==="@/lib/building-parking")return{ParkingError,lockBuildingParking:async()=>{}};
   if(id==="@/lib/rfid-access")return{lockRfid:async()=>{},rfidApiError:e=>Response.json({ok:false,message:e.message},{status:e.status||500})};
   if(id==="@/lib/manual-exit")return load("src/lib/manual-exit.ts");
   if(id==="@/lib/manual-exit-notifications")return{notificationContext:async()=>{if(!["BUILDING_ADMIN","SUPER_ADMIN"].includes(state.user.role))throw new ParkingError("Forbidden",403);return{user:state.user,where:state.user.role==="SUPER_ADMIN"?{}:{buildingId:{in:[state.user.buildingId]}}};}};
   return require(id);
  }});return cache[file]=module.exports;
 }
 const request=()=>load("src/app/api/supervisor/manual-exit/route.ts").POST(new Request("http://test",{method:"POST",body:JSON.stringify({id:"owner:v"})}));
 const approve=()=>load("src/app/api/notifications/[id]/approve/route.ts").POST(new Request("http://test",{method:"POST"}),{params:Promise.resolve({id:"n0"})});
 return{state,request,approve};
}
test("Supervisor request stays on site and repeated clicks create one request",async()=>{
 const f=fixture();assert.equal((await f.request()).status,200);assert.equal((await f.request()).status,200);assert.equal(f.state.target.isInside,true);assert.equal(f.state.events.length,0);assert.equal(f.state.notices.length,1);
});
test("Either Admin or Super Admin can approve one exit",async()=>{
 for(const role of ["BUILDING_ADMIN","SUPER_ADMIN"]){const f=fixture();await f.request();f.state.user={...f.state.user,id:"approver",role};assert.equal((await f.approve()).status,200);assert.equal(f.state.target.isInside,false);assert.equal(f.state.events.length,1);assert.equal(f.state.notices[0].status,"APPROVED");assert.equal((await f.approve()).status,409);assert.equal(f.state.events.length,1);}
});
test("Concurrent approvals produce only one exit",async()=>{
 const f=fixture();await f.request();f.state.user.role="BUILDING_ADMIN";const results=await Promise.all([f.approve(),f.approve()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.state.events.length,1);
});
test("Other buildings and supervisors cannot approve",async()=>{
 const f=fixture();await f.request();assert.equal((await f.approve()).status,403);f.state.user.role="BUILDING_ADMIN";f.state.user.buildingId="other";assert.equal((await f.approve()).status,404);assert.equal(f.state.target.isInside,true);
});
test("A request for an already-exited vehicle closes without another exit",async()=>{
 const f=fixture();await f.request();f.state.target.isInside=false;f.state.user.role="BUILDING_ADMIN";assert.equal((await f.approve()).status,200);assert.equal(f.state.notices[0].status,"CLOSED");assert.equal(f.state.events.length,0);
});
test("Failed request storage never exits the vehicle",async()=>{
 const f=fixture();f.state.failCreate=true;assert.equal((await f.request()).status,500);assert.equal(f.state.target.isInside,true);assert.equal(f.state.events.length,0);
});

test("Approval of an old request cannot exit a vehicle that has exited and re-entered",async()=>{
 const f=fixture();f.state.target.lastAccessAt=new Date("2026-10-12T08:00:00Z");await f.request();
 f.state.target.lastAccessAt=new Date("2026-10-12T09:00:00Z");f.state.user.role="BUILDING_ADMIN";
 assert.equal((await f.approve()).status,200);assert.equal(f.state.notices[0].status,"CLOSED");assert.equal(f.state.target.isInside,true);assert.equal(f.state.events.length,0);
});
