import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';

test('order history keeps tenant boundaries, stable pagination and financial snapshots',async t=>{
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
  const history=(status='ALL',search='',cursor=null)=>rpc('rpc_order_history',['2026-10-20','2026-10-20',status,search,cursor?.time||null,cursor?.id||null]);
  const product=await rpc('rpc_create_product',[{name:'Cà phê gốc',variants:[{name:'M',price:35000}],modifiers:[{name:'Sữa',price:5000}]}]);
  const variant=(await db.query('SELECT id FROM public.product_variants WHERE product_id=$1',[product])).rows[0].id;
  const modifier=(await db.query('SELECT id FROM public.product_modifiers WHERE product_id=$1',[product])).rows[0].id;
  const save=()=>rpc('rpc_save_order',[randomUUID(),'TAKEAWAY',null,[{variant_id:variant,quantity:2,modifier_ids:[modifier]}],{name:'Khách An',phone:'0900123456'},null,null]);
  const paid=await save(),open=await save(),voided=await save();const shift=await rpc('rpc_open_shift',[randomUUID(),100000]);
  const payment=await rpc('rpc_collect_payment',[paid.order_id,shift.id,randomUUID(),paid.revision,'CASH',100000,false]);
  await rpc('rpc_refund_payment',[payment.id,shift.id,randomUUID(),'Khách đổi ý sau thanh toán']);
  await rpc('rpc_void_order',[voided.order_id,voided.revision,randomUUID(),'Hủy theo yêu cầu khách']);
  await db.exec('RESET ROLE');await db.query("UPDATE public.orders SET created_at='2026-10-20T02:00:00Z' WHERE store_id=$1",[w.store_id]);await actor(owner);
  await t.test('paid, refunded, open and void filters use actual persisted status',async()=>{
   assert.equal((await history()).orders.length,3);
   assert.deepEqual((await history('PAID')).orders.map(o=>o.id),[paid.order_id]);
   assert.deepEqual((await history('REFUNDED')).orders.map(o=>o.id),[paid.order_id]);
   assert.deepEqual((await history('OPEN')).orders.map(o=>o.id),[open.order_id]);
   assert.deepEqual((await history('VOID')).orders.map(o=>o.id),[voided.order_id]);
   const row=(await history('REFUNDED')).orders[0];assert.equal(row.paid_amount,80000);assert.equal(row.refund_amount,80000);
  });
  await t.test('search is literal, bounded and includes order prefix, name and phone',async()=>{
   assert.equal((await history('ALL','khÁch an')).orders.length,3);assert.equal((await history('ALL','0900123')).orders.length,3);
   assert.equal((await history('ALL',paid.order_id.slice(0,8))).orders[0].id,paid.order_id);
   assert.equal((await history('ALL','%')).orders.length,0);
   await assert.rejects(rpc('rpc_order_history',['2026-01-01','2026-10-20']),/INVALID_HISTORY_FILTER/);
   await assert.rejects(rpc('rpc_order_history',['2026-10-21','2026-10-20']),/INVALID_HISTORY_FILTER/);
   await assert.rejects(history('INVALID'),/INVALID_HISTORY_FILTER/);
   await assert.rejects(rpc('rpc_order_history',['2026-10-20','2026-10-20','ALL','',null,randomUUID()]),/INVALID_HISTORY_FILTER/);
  });
  await t.test('receipt preserves purchased prices and payment/refund amounts after menu changes',async()=>{
   await rpc('rpc_update_variant',[variant,99000,true]);
   const receipt=await rpc('rpc_order_receipt',[paid.order_id]);assert.equal(receipt.items[0].product_name,'Cà phê gốc');assert.equal(receipt.items[0].unit_amount,40000);assert.equal(receipt.items[0].modifier_snapshot[0].name,'Sữa');
   assert.equal(receipt.payment.amount,80000);assert.equal(receipt.payment.received_amount,100000);assert.equal(receipt.payment.change_amount,20000);assert.equal(receipt.refund.amount,80000);assert.equal(receipt.refund.reason,'Khách đổi ý sau thanh toán');
   const unpaid=await rpc('rpc_order_receipt',[open.order_id]);assert.equal(unpaid.payment,null);assert.equal(unpaid.refund,null);assert.equal((await rpc('rpc_order_receipt',[voided.order_id])).void_reason,'Hủy theo yêu cầu khách');
  });
  await t.test('store timezone includes both day boundaries correctly',async()=>{
   await db.exec('RESET ROLE');for(const at of ['2026-10-19T16:59:59Z','2026-10-19T17:00:00Z','2026-10-20T16:59:59Z','2026-10-20T17:00:00Z'])await db.query("INSERT INTO public.orders(organization_id,store_id,channel,customer,created_by,created_at) VALUES($1,$2,'TAKEAWAY',$3,$4,$5)",[w.organization_id,w.store_id,{name:'boundary'},owner,at]);
   await actor(owner);const page=await history('ALL','boundary');assert.equal(page.orders.length,2);assert.equal(page.timezone,'Asia/Ho_Chi_Minh');
  });
  await t.test('keyset pagination handles identical timestamps and new orders without duplicates',async()=>{
   await db.exec('RESET ROLE');for(let i=0;i<53;i++)await db.query("INSERT INTO public.orders(organization_id,store_id,channel,customer,created_by,created_at) VALUES($1,$2,'TAKEAWAY',$3,$4,'2026-10-20T08:00:00Z')",[w.organization_id,w.store_id,{name:'paging'},owner]);
   await actor(owner);const first=await history('ALL','paging');assert.equal(first.orders.length,50);assert.ok(first.next_cursor);
   await db.exec('RESET ROLE');await db.query("INSERT INTO public.orders(organization_id,store_id,channel,customer,created_by,created_at) VALUES($1,$2,'TAKEAWAY',$3,$4,'2026-10-20T09:00:00Z')",[w.organization_id,w.store_id,{name:'paging'},owner]);await actor(owner);
   const second=await history('ALL','paging',first.next_cursor);assert.equal(second.orders.length,3);assert.equal(second.next_cursor,null);
   assert.equal(new Set([...first.orders,...second.orders].map(o=>o.id)).size,53);
  });
  await t.test('cashier reads only its assigned store; another tenant and anonymous callers are denied',async()=>{
   const token=randomBytes(32).toString('base64url');await rpc('rpc_create_staff_invitation',[randomUUID(),'cashier@test.example','CASHIER',token]);
   await actor(cashier);await db.query('SELECT public.rpc_accept_staff_invitation($1,$2)',[token,'Thu ngân']);assert.equal((await history('REFUNDED')).orders.length,1);assert.equal((await rpc('rpc_order_receipt',[paid.order_id])).order.id,paid.order_id);
   await assert.rejects(rpc('rpc_order_receipt',[randomUUID()]),/ORDER_NOT_FOUND/);
   await db.exec('RESET ROLE');const second=(await db.query("INSERT INTO public.stores(organization_id,code,name,address) VALUES($1,'SECOND','Second','Test') RETURNING id",[w.organization_id])).rows[0].id;await actor(cashier);
   await assert.rejects(rpc('rpc_order_history',[],second),/PERMISSION_DENIED/);await assert.rejects(rpc('rpc_order_receipt',[paid.order_id],second),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');await db.query("UPDATE public.memberships SET status='SUSPENDED' WHERE organization_id=$1 AND user_id=$2",[w.organization_id,cashier]);await actor(cashier);await assert.rejects(history(),/PERMISSION_DENIED/);
   await actor(other);await assert.rejects(history(),/PERMISSION_DENIED/);await assert.rejects(rpc('rpc_order_receipt',[paid.order_id]),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');await db.exec('SET ROLE anon');await assert.rejects(history(),/permission denied/);
  });
 }finally{await db.close();}
});
