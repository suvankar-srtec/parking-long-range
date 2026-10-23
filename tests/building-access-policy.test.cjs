const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function fixture(user) {
  const state = { updates: [], reset: null };
  class ParkingError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
  const tx = {
    building: { update: async ({data}) => { state.updates.push(data); return data; } },
    rfidReader: { findMany: async () => [{deviceNumber:'80M236-A'}, {deviceNumber:'80M236-B'}] },
    cloudCOffline: { updateMany: async args => { state.reset=args; } }
  };
  const prisma = { building: {findUnique: async () => ({superAdminId:'sa'})}, $transaction: async fn => fn(tx) };
  const module = {exports:{}};
  const code = ts.transpileModule(fs.readFileSync('src/app/api/buildings/[id]/access-policy/route.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {module,exports:module.exports,Set,require(id) {
    if(id==='next/server') return {NextResponse:{json:body=>Response.json(body)}};
    if(id==='@/lib/prisma') return {prisma};
    if(id==='@/lib/session') return {getCurrentUser:async()=>user};
    if(id==='@/lib/super-admin-scope') return {isPrimarySuperAdmin:u=>u.id==='primary'};
    if(id==='@/lib/building-parking') return {ParkingError,lockBuildingParking:async()=>{}};
    if(id==='@/lib/rfid-access') return {rfidApiError:e=>Response.json({message:e.message},{status:e.status||500})};
    return require(id);
  }});
  return {state,save:(body={parkingLimitsEnabled:false,antiPassbackEnabled:true})=>module.exports.PATCH(new Request('http://test',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:'b'})})};
}
test('Assigned Admin and owning/primary Super Admin can update independent switches',async()=>{
  for (const user of [{role:'BUILDING_ADMIN',buildingId:'b'}, {role:'SUPER_ADMIN',id:'sa'}, {role:'SUPER_ADMIN',id:'primary'}]) {
    const f=fixture(user); assert.equal((await f.save()).status,200);
    assert.equal(f.state.updates[0].parkingLimitsEnabled,false); assert.equal(f.state.updates[0].antiPassbackEnabled,true);
    assert.equal(f.state.reset.where.serial.in.join(','),'80M236'); assert.equal(f.state.reset.data.checkedAt,null);
  }
});
test('Other buildings, non-owning Super Admins, Company Admins and signed-out users cannot change policies',async()=>{
  for (const user of [null,{role:'BUILDING_ADMIN',buildingId:'other'},{role:'SUPER_ADMIN',id:'other'},{role:'COMPANY_ADMIN',buildingId:'b'},{role:'EMPLOYEE',buildingId:'b'}]) {
    const f=fixture(user); assert.equal((await f.save()).status,403); assert.equal(f.state.updates.length,0);
  }
});
test('Policy API rejects missing, string and unexpected fields without writing',async()=>{
  const f=fixture({role:'BUILDING_ADMIN',buildingId:'b'});
  for(const body of [{},{parkingLimitsEnabled:'false',antiPassbackEnabled:true},{parkingLimitsEnabled:false,antiPassbackEnabled:false,enabled:false},[]]) assert.equal((await f.save(body)).status,400);
  assert.equal(f.state.updates.length,0);
});
