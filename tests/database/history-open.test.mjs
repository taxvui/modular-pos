import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';

test('opening historical orders returns one current snapshot without mutating data',async t=>{
 const db=new PGlite(),owner=randomUUID(),other=randomUUID(),cashier=randomUUID();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   GRANT USAGE ON SCHEMA auth TO authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec((await readFile('supabase/migrations/'+file,'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/,''));
  await db.query('INSERT INTO auth.users VALUES($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'owner@test.example',other,'other@test.example',cashier,'cashier@test.example']);
  const actor=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('SET ROLE authenticated');};
  const boot=async(id,slug)=>{await actor(id);return(await db.query('SELECT public.rpc_bootstrap_workspace($1,$2,$3,$4) d',[slug,slug,'Main','Test'])).rows[0].d;};
  const w=await boot(owner,'history-a');await boot(other,'history-b');await actor(owner);
  const rpc=async(name,args=[],store=w.store_id)=>(await db.query('SELECT public.'+name+'('+['$1','$2',...args.map((_,i)=>'$'+(i+3))].join(',')+') d',[w.organization_id,store,...args])).rows[0].d;
  const product=await rpc('rpc_create_product',[{name:'Coffee original',variants:[{name:'M',price:35000}],modifiers:[{name:'Milk',price:5000}]}]);
  const variant=(await db.query('SELECT id FROM public.product_variants WHERE product_id=$1',[product])).rows[0].id;
  const modifier=(await db.query('SELECT id FROM public.product_modifiers WHERE product_id=$1',[product])).rows[0].id;
  const a=await rpc('rpc_create_position',['Old table']),b=await rpc('rpc_create_position',['New table']);
  const items=quantity=>[{variant_id:variant,quantity,modifier_ids:[modifier]}];
  const original=await rpc('rpc_save_order',[randomUUID(),'DINE_IN',a,items(1),{name:'Guest',phone:'0900123456'},null,null]);
  const snapshot=()=>rpc('rpc_open_order',[original.order_id]);
  await t.test('order outside the recent-200 list is still openable with exact persisted prices',async()=>{
   await db.exec('RESET ROLE');await db.query("UPDATE public.orders SET updated_at='2026-10-01',created_at='2026-10-01' WHERE id=$1",[original.order_id]);
   for(let i=0;i<201;i++)await db.query("INSERT INTO public.orders(organization_id,store_id,channel,created_by) VALUES($1,$2,'TAKEAWAY',$3)",[w.organization_id,w.store_id,owner]);await actor(owner);
   const recent=(await db.query("SELECT id FROM public.orders WHERE store_id=$1 AND order_status='OPEN' ORDER BY updated_at DESC LIMIT 200",[w.store_id])).rows;assert.equal(recent.some(o=>o.id===original.order_id),false);
   const data=await snapshot();assert.equal(data.order.id,original.order_id);assert.equal(data.order.total_amount,40000);assert.equal(data.items[0].variant_id,variant);assert.equal(data.items[0].modifier_snapshot[0].id,modifier);assert.equal(data.position_name,'Old table');
  });
  await t.test('new revision, moved table, customer and items are read together without repricing',async()=>{
   const updated=await rpc('rpc_save_order',[randomUUID(),'DINE_IN',a,items(2),{name:'Changed guest'},original.order_id,1]);
   const moved=await rpc('rpc_transfer_order',[original.order_id,updated.revision,b,randomUUID(),'Moved by another device']);
   await rpc('rpc_update_variant',[variant,99000,false]);
   await db.exec('RESET ROLE');await db.query('UPDATE public.service_positions SET active=false WHERE id=$1',[b]);await actor(owner);
   const before=(await db.query('SELECT count(*) n FROM public.audit_logs')).rows[0].n;
   const data=await snapshot();assert.equal(data.order.revision,moved.revision);assert.equal(data.order.customer.name,'Changed guest');assert.equal(data.order.position_id,b);assert.equal(data.position_name,'New table');assert.equal(data.items[0].quantity,2);assert.equal(data.items[0].unit_amount,40000);assert.equal(data.order.total_amount,80000);
   assert.equal((await db.query('SELECT count(*) n FROM public.audit_logs')).rows[0].n,before,'Opening is read-only');
  });
  await t.test('cashier can read snapshot; a reporting-only role cannot use the editing endpoint',async()=>{
   const token=randomBytes(32).toString('base64url');await rpc('rpc_create_staff_invitation',[randomUUID(),'cashier@test.example','CASHIER',token]);await actor(cashier);await db.query('SELECT public.rpc_accept_staff_invitation($1,$2)',[token,'Cashier']);assert.equal((await snapshot()).order.id,original.order_id);
   await db.exec('RESET ROLE');await db.query("DELETE FROM public.role_permissions rp USING public.roles r,public.permissions p WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.organization_id=$1 AND r.code='POS_STAFF_CASHIER' AND p.permission_key='pos.order.write'",[w.organization_id]);
   await db.query("INSERT INTO public.role_permissions(organization_id,role_id,permission_id) SELECT r.organization_id,r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.organization_id=$1 AND r.code='POS_STAFF_CASHIER' AND p.permission_key='pos.report.read'",[w.organization_id]);await actor(cashier);
   assert.equal((await rpc('rpc_order_receipt',[original.order_id])).order.id,original.order_id);await assert.rejects(snapshot(),/PERMISSION_DENIED/);await actor(owner);
  });
  await t.test('paid, refunded and void orders cannot be opened for editing',async()=>{
   const shift=await rpc('rpc_open_shift',[randomUUID(),100000]);const pay=await rpc('rpc_collect_payment',[original.order_id,shift.id,randomUUID(),3,'CASH',100000,false]);await assert.rejects(snapshot(),/ORDER_FINALIZED/);
   await rpc('rpc_refund_payment',[pay.id,shift.id,randomUUID(),'Guest refund']);await assert.rejects(snapshot(),/ORDER_FINALIZED/);
   await rpc('rpc_update_variant',[variant,35000,true]);const order=await rpc('rpc_save_order',[randomUUID(),'TAKEAWAY',null,items(1),{},null,null]);await rpc('rpc_void_order',[order.order_id,1,randomUUID(),'Guest cancelled']);await assert.rejects(rpc('rpc_open_order',[order.order_id]),/ORDER_FINALIZED/);
  });
  await t.test('foreign tenant/store, missing order, suspended membership and anonymous callers are denied',async()=>{
   await assert.rejects(rpc('rpc_open_order',[randomUUID()]),/ORDER_NOT_FOUND/);
   await db.exec('RESET ROLE');const second=(await db.query("INSERT INTO public.stores(organization_id,code,name,address) VALUES($1,'SECOND','Second','Test') RETURNING id",[w.organization_id])).rows[0].id;await actor(owner);await assert.rejects(rpc('rpc_open_order',[original.order_id],second),/ORDER_NOT_FOUND/);
   await actor(other);await assert.rejects(snapshot(),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');await db.query("UPDATE public.memberships SET status='SUSPENDED' WHERE organization_id=$1 AND user_id=$2",[w.organization_id,owner]);await actor(owner);await assert.rejects(snapshot(),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');await db.exec('SET ROLE anon');await assert.rejects(snapshot(),/permission denied/);
  });
 }finally{await db.close();}
});
