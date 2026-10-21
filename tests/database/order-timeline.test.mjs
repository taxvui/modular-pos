import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';

test('order timeline links only scoped order and payment audits with safe projections',async t=>{
 const db=new PGlite(),owner=randomUUID(),other=randomUUID(),staff=randomUUID();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   GRANT USAGE ON SCHEMA auth TO authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec((await readFile('supabase/migrations/'+file,'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/,''));
  await db.query('INSERT INTO auth.users VALUES($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'owner@transfer.test',other,'other@transfer.test',staff,'staff@transfer.test']);
  const actor=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('SET ROLE authenticated');};
  const boot=async(id,slug)=>{await actor(id);return(await db.query('SELECT public.rpc_bootstrap_workspace($1,$2,$3,$4) d',[slug,slug,'Main','Test'])).rows[0].d;};
  const w=await boot(owner,'transfer-a'),foreign=await boot(other,'transfer-b');await actor(owner);
  const rpc=async(name,args=[],store=w.store_id)=>(await db.query('SELECT public.'+name+'('+['$1','$2',...args.map((_,i)=>'$'+(i+3))].join(',')+') d',[w.organization_id,store,...args])).rows[0].d;
  const a=await rpc('rpc_create_position',['A']),b=await rpc('rpc_create_position',['B']);
  const product=await rpc('rpc_create_product',[{name:'Coffee',variants:[{name:'M',price:35000}],modifiers:[]}]);
  const variant=(await db.query('SELECT id FROM public.product_variants WHERE product_id=$1',[product])).rows[0].id;
  const items=quantity=>[{variant_id:variant,quantity,modifier_ids:[]}];
  const create=()=>rpc('rpc_save_order',[randomUUID(),'TAKEAWAY',null,items(1),{name:'Private customer',phone:'0900123456'},null,null]);
  const original=await rpc('rpc_save_order',[randomUUID(),'DINE_IN',a,items(1),{name:'Private customer',phone:'0900123456'},null,null]);
  const edited=await rpc('rpc_save_order',[randomUUID(),'DINE_IN',a,items(2),{name:'Private customer'},original.order_id,1]);
  const moved=await rpc('rpc_transfer_order',[original.order_id,edited.revision,b,randomUUID(),'Guest requested B']);
  const shift=await rpc('rpc_open_shift',[randomUUID(),100000]);
  const payment=await rpc('rpc_collect_payment',[original.order_id,shift.id,randomUUID(),moved.revision,'CASH',100000,false]);
  const refundArgs=[payment.id,shift.id,randomUUID(),'Customer refund <script>text</script>'];
  await rpc('rpc_refund_payment',refundArgs);await rpc('rpc_refund_payment',refundArgs);
  const otherOrder=await create(),otherPay=await rpc('rpc_collect_payment',[otherOrder.order_id,shift.id,randomUUID(),1,'TRANSFER',35000,true]);
  await rpc('rpc_refund_payment',[otherPay.id,shift.id,randomUUID(),'Other refund']);
  const events=(id=original.order_id,cursor=null)=>rpc('rpc_order_events',[id,cursor?.time||null,cursor?.id||null]);
  await t.test('saved, transfer, collection and refund each appear once with actor and original amounts',async()=>{
   const result=await events();assert.equal(result.events.length,5);assert.equal(result.timezone,'Asia/Ho_Chi_Minh');assert.equal(result.order_id,original.order_id);assert.equal(result.next_cursor,null);
   assert.ok(result.events.every(e=>e.actor_id===owner));assert.equal(result.events.filter(e=>e.action==='pos.order.saved').length,2);
   const transfer=result.events.find(e=>e.action==='pos.order.transferred');assert.equal(transfer.details.from_position_id,a);assert.equal(transfer.details.to_position_id,b);assert.equal(transfer.details.from_position_name,'A');assert.equal(transfer.reason,'Guest requested B');assert.equal(transfer.details.total_amount,70000);
   const collect=result.events.find(e=>e.action==='pos.payment.collected');assert.equal(collect.details.payment_id,payment.id);assert.equal(collect.details.received_amount,100000);assert.equal(collect.details.change_amount,30000);
   const returned=result.events.find(e=>e.action==='pos.payment.refunded');assert.equal(returned.details.payment_id,payment.id);assert.equal(returned.reason,refundArgs[3]);assert.equal(returned.details.amount,70000);assert.equal(returned.details.shift_id,shift.id);
   const safe=JSON.stringify(result);assert.equal(safe.includes('Private customer'),false);assert.equal(safe.includes('0900123456'),false);assert.equal(safe.includes('before_state'),false);assert.equal(safe.includes('Other refund'),false);
  });
  await t.test('voided orders include reason and unknown actions or secret payloads stay private',async()=>{
   const order=await create();await rpc('rpc_void_order',[order.order_id,1,randomUUID(),'Guest cancellation']);
   await db.exec('RESET ROLE');
   await db.query("INSERT INTO public.audit_logs(organization_id,store_id,actor_user_id,module_key,action_key,entity_type,entity_id,after_state,metadata) VALUES($1,$2,$3,'pos','pos.order.saved','order',$4,$5,$6),($1,$2,$3,'pos','pos.internal.secret','order',$4,$5,$6)",[w.organization_id,w.store_id,owner,order.order_id,{revision:99,total_amount:35000,customer:{phone:'secret-phone'},access_token:'secret-token'},{invitation_token:'secret-invite'}]);
   await actor(owner);const result=await events(order.order_id);assert.equal(result.events.length,3);const voided=result.events.find(e=>e.action==='pos.order.voided');assert.equal(voided.reason,'Guest cancellation');assert.equal(voided.details.revision,2);assert.equal(JSON.stringify(result).includes('secret-'),false);
  });
  await t.test('identical timestamps page without duplicates when new events arrive',async()=>{
   const order=await create();await db.exec('RESET ROLE');
   const insert=at=>db.query("INSERT INTO public.audit_logs(organization_id,store_id,actor_user_id,module_key,action_key,entity_type,entity_id,created_at,after_state) VALUES($1,$2,$3,'pos','pos.order.saved','order',$4,$5,$6)",[w.organization_id,w.store_id,owner,order.order_id,at,{revision:2,total_amount:35000}]);
   for(let i=0;i<53;i++)await insert('2026-10-20T08:00:00Z');await actor(owner);
   const first=await events(order.order_id);assert.equal(first.events.length,50);assert.ok(first.next_cursor);
   await db.exec('RESET ROLE');await insert('2026-10-21T20:00:00Z');await actor(owner);
   const second=await events(order.order_id,first.next_cursor);assert.equal(second.events.length,4);assert.equal(second.next_cursor,null);assert.equal(new Set([...first.events,...second.events].map(e=>e.id)).size,54);
  });
  await t.test('malformed cursors and nonexistent order IDs are rejected',async()=>{
   await assert.rejects(rpc('rpc_order_events',[original.order_id,null,randomUUID()]),/INVALID_EVENT_FILTER/);
   await assert.rejects(rpc('rpc_order_events',[original.order_id,'2026-10-20',null]),/INVALID_EVENT_FILTER/);
   await assert.rejects(events(randomUUID()),/ORDER_NOT_FOUND/);
  });
  await t.test('cashier reads allowed order events without gaining direct audit table access',async()=>{
   const token=randomBytes(32).toString('base64url');await rpc('rpc_create_staff_invitation',[randomUUID(),'staff@transfer.test','CASHIER',token]);await actor(staff);await db.query('SELECT public.rpc_accept_staff_invitation($1,$2)',[token,'Cashier']);
   assert.equal((await events()).events.length,5);assert.equal((await db.query('SELECT id FROM public.audit_logs')).rows.length,0);
  });
  await t.test('foreign store, tenant, revoked membership and anonymous reads are denied',async()=>{
   await assert.rejects(rpc('rpc_order_events',[original.order_id],foreign.store_id),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');const second=(await db.query("INSERT INTO public.stores(organization_id,code,name,address) VALUES($1,'SECOND','Second','Test') RETURNING id",[w.organization_id])).rows[0].id;await actor(owner);await assert.rejects(rpc('rpc_order_events',[original.order_id],second),/ORDER_NOT_FOUND/);
   await actor(other);await assert.rejects(events(),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');await db.query("UPDATE public.memberships SET status='SUSPENDED' WHERE organization_id=$1 AND user_id=$2",[w.organization_id,staff]);await actor(staff);await assert.rejects(events(),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');await db.exec('SET ROLE anon');await assert.rejects(events(),/permission denied/);
  });
 }finally{await db.close();}
});
