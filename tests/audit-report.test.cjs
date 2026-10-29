const {test,after}=require('node:test');
const assert=require('node:assert/strict');
process.loadEnvFile('.env');
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();after(()=>p.$disconnect());
test('audit snapshots redact secrets recursively',async()=>{
 const [row]=await p.$queryRaw`SELECT audit_redact(${JSON.stringify({password:'secret-password',nested:{token:'secret-token',name:'Visible'},items:[{authorization:'secret-header'}]})}::jsonb) AS value`;
 assert.equal(row.value.password,'[REDACTED]');assert.equal(row.value.nested.token,'[REDACTED]');assert.equal(row.value.nested.name,'Visible');assert.equal(row.value.items[0].authorization,'[REDACTED]');
});
test('database changes atomically preserve before/after and survive entity deletion',async()=>{
 const id='audit-test-'+require('node:crypto').randomUUID();
 const rollback=new Error('ROLLBACK_FIXTURE');
 await assert.rejects(p.$transaction(async tx=>{
  await tx.$executeRaw`INSERT INTO buildings(id,name,"totalParking","ownerParking","companyParking","updatedAt") VALUES(${id},${id},10,2,8,now())`;
  await tx.$executeRaw`UPDATE buildings SET "ownerParking"=3,"companyParking"=7 WHERE id=${id}`;
  let records=await tx.$queryRaw`SELECT action,details FROM audit_records WHERE "entityType"='buildings' AND "entityId"=${id} ORDER BY id`;
  assert.equal(records.length,2);assert.equal(records[1].details.before.ownerParking,2);assert.equal(records[1].details.after.ownerParking,3);assert.ok(records[1].details.changedFields.includes('ownerParking'));
  await tx.$executeRaw`DELETE FROM buildings WHERE id=${id}`;
  records=await tx.$queryRaw`SELECT action FROM audit_records WHERE "entityType"='buildings' AND "entityId"=${id}`;
  assert.equal(records.length,3);throw rollback;
 },{timeout:20000}),e=>e===rollback);
});
for(const operation of ['UPDATE audit_records SET result=result WHERE false','DELETE FROM audit_records WHERE false','TRUNCATE audit_records']){
 test('append-only guard blocks '+operation.split(' ')[0],async()=>{
  await assert.rejects(p.$transaction(async tx=>{await tx.$executeRawUnsafe(operation);throw new Error('GUARD_MISSING');}),e=>/append-only/.test(String(e)));
 });
}
test('every intended business table has a capture trigger',async()=>{
 const rows=await p.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'audit_capture_%'`;
 for(const name of ['users','buildings','companies','employees','vehicles','rfid_events','rfid_readers','gates','manual_exit_notifications','cloudc_history'])assert.ok(rows.some(r=>r.tgname==='audit_capture_'+name));
});
