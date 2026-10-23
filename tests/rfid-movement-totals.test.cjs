const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {PrismaClient,Prisma}=require('@prisma/client');
process.loadEnvFile('.env');
const prisma=new PrismaClient({log:[]});
const moduleWrapper={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/rfid-movement-totals.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleWrapper,exports:moduleWrapper.exports,require(id){return id==='@/lib/prisma'?{prisma}:require(id);}});
const {dailyMovements}=moduleWrapper.exports;
test('Daily movement SQL excludes repeat scans, preserves opening occupancy and scopes buildings and companies',async()=>{
 const tag='MOVEMENT-TEST-'+require('node:crypto').randomUUID();let b,other;
 try {
  b=await prisma.building.create({data:{name:tag,totalParking:10,ownerParking:10,companyParking:0}});
  other=await prisma.building.create({data:{name:tag+'-other',totalParking:10,ownerParking:10,companyParking:0}});
  const c=await prisma.company.create({data:{name:tag,buildingId:b.id,parkingAllocation:0}});
  const start=new Date('2020-01-02T00:00:00Z'),end=new Date('2020-01-03T00:00:00Z');
  const event=(cardNo,action,time,extra={})=>({buildingId:b.id,deviceNumber:'synthetic',cardNo,action,code:'0000',message:tag,createdAt:new Date(time),...extra});
  await prisma.rfidEvent.createMany({data:[
   event('A','ENTRY','2020-01-01T20:00:00Z'),
   event('A','EXIT','2020-01-02T01:00:00Z'),event('A','EXIT','2020-01-02T02:00:00Z'),
   event('A','ENTRY','2020-01-02T03:00:00Z'),event('A','ENTRY','2020-01-02T04:00:00Z'),
   event('B','EXIT','2020-01-02T05:00:00Z'),event('B','EXIT','2020-01-02T06:00:00Z'),
   event('C','ENTRY','2020-01-02T07:00:00Z',{companyId:c.id}),
   event('D','ENTRY','2020-01-02T08:00:00Z',{code:'0001'}),
   event('A','EXIT','2020-01-03T00:00:00Z'),
   event('A','ENTRY','2020-01-02T09:00:00Z',{buildingId:other.id})
  ]});
  assert.deepEqual({...await dailyMovements(b.id,null,start,end)},{totalIn:2,totalOut:2,openingOnSite:2});
  assert.deepEqual({...await dailyMovements(b.id,c.id,start,end)},{totalIn:1,totalOut:0,openingOnSite:0});
  assert.deepEqual({...await dailyMovements(other.id,null,start,end)},{totalIn:1,totalOut:0,openingOnSite:0});
  // Delayed controller history must be ordered by scan time, not insert time.
  await prisma.rfidEvent.create({data:event('B','ENTRY','2020-01-01T23:00:00Z')});
  assert.deepEqual({...await dailyMovements(b.id,null,start,end)},{totalIn:2,totalOut:2,openingOnSite:2});
 } finally {
  if(b) await prisma.building.delete({where:{id:b.id}});
  if(other) await prisma.building.delete({where:{id:other.id}});
  await prisma.$disconnect();
 }
});
