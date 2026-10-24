const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function fixture(used,limit=5){
 let created=0;
 class ParkingError extends Error{constructor(message,status=400){super(message);this.status=status;}}
 const tx={employee:{findFirst:async()=>({id:'person',parkingLimit:limit,isPlaceholder:false})},company:{findUnique:async()=>({buildingId:'building',enabled:true})},companyDepartment:{findFirst:async()=>({id:'dept'})},vehicle:{count:async()=>used,create:async()=>{created++;return{id:'vehicle'};}}};
 const mod={exports:{}};
 const code=ts.transpileModule(fs.readFileSync('src/app/api/companies/[id]/employees/[employeeId]/vehicles/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require(id){
  if(id==='next/server')return{NextResponse:{json:(body,options)=>Response.json(body,options)}};
  if(id==='next/cache')return{revalidatePath:()=>{}};
  if(id==='@/lib/prisma')return{prisma:{$transaction:async fn=>fn(tx)}};
  if(id==='@/lib/session')return{getCurrentUser:async()=>({id:'u',role:'COMPANY_ADMIN',companyId:'company'})};
  if(id==='@/lib/permissions')return{hasPermission:()=>true};
  if(id==='@/lib/company-card-access')return{companyCardScope:()=>({})};
  if(id==='@/lib/building-parking')return{ParkingError,lockBuildingParking:async()=>{}};
  if(id==='@/lib/rfid-access')return{lockRfid:async()=>{},RFID_TRANSACTION:{}};
  return require(id);
 }});
 return{created:()=>created,save:()=>mod.exports.POST(new Request('http://test',{method:'POST',body:JSON.stringify({ownerName:'Person',plateNumber:'TEST-1',vehicleType:'Four wheeler',department:'Sales',workerType:'Employee'})}),{params:Promise.resolve({id:'company',employeeId:'person'})})};
}
test('First vehicle is allowed for a person with parking allocation',async()=>{const f=fixture(0);assert.equal((await f.save()).status,201);assert.equal(f.created(),1);});
test('A legacy allowance greater than one cannot permit a second vehicle',async()=>{const f=fixture(1);const r=await f.save();assert.equal(r.status,400);assert.match((await r.json()).message,/Only one parking space/);assert.equal(f.created(),0);});
test('An existing zero allocation remains denied',async()=>{const f=fixture(0,0);assert.equal((await f.save()).status,400);assert.equal(f.created(),0);});
