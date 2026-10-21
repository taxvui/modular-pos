import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';

test('table transfers preserve snapshots, serialize revisions and enforce store permissions',async t=>{
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
  const a=await rpc('rpc_create_position',['A']),b=await rpc('rpc_create_position',['B']),c=await rpc('rpc_create_position',['C']);
  const product=await rpc('rpc_create_product',[{name:'Coffee',variants:[{name:'M',price:35000}],modifiers:[{name:'Milk',price:5000}]}]);
  const variant=(await db.query('SELECT id FROM public.product_variants WHERE product_id=$1',[product])).rows[0].id;
  const modifier=(await db.query('SELECT id FROM public.product_modifiers WHERE product_id=$1',[product])).rows[0].id;
  const save=(position,channel='DINE_IN')=>rpc('rpc_save_order',[randomUUID(),channel,position,[{variant_id:variant,quantity:2,modifier_ids:[modifier]}],{name:'Guest'},null,null]);
  const order=await save(a),occupied=await save(c),takeaway=await save(null,'TAKEAWAY');
  const before=(await db.query('SELECT * FROM public.order_items WHERE order_id=$1',[order.order_id])).rows;
  const token=randomBytes(32).toString('base64url');await rpc('rpc_create_staff_invitation',[randomUUID(),'staff@transfer.test','CASHIER',token]);
  await actor(staff);await db.query('SELECT public.rpc_accept_staff_invitation($1,$2)',[token,'Cashier']);
  const operation=randomUUID(),args=[order.order_id,order.revision,b,operation,'Customer requested table change'];
  const delayed=[occupied.order_id,1,b,randomUUID(),'Move after payment'];
  let moved;
  await t.test('cashier moves an open order without repricing inactive menu items',async()=>{
   await actor(owner);await rpc('rpc_update_variant',[variant,99000,false]);await actor(staff);
   moved=await rpc('rpc_transfer_order',args);assert.equal(moved.position_id,b);assert.equal(moved.previous_position_id,a);assert.equal(moved.revision,2);assert.equal(moved.total_amount,80000);
   assert.deepEqual((await db.query('SELECT * FROM public.order_items WHERE order_id=$1',[order.order_id])).rows,before);
   const stored=(await db.query('SELECT * FROM public.orders WHERE id=$1',[order.order_id])).rows[0];assert.equal(stored.customer.name,'Guest');assert.equal(stored.position_id,b);
  });
  await t.test('exact retry acknowledges once; changed actor or payload cannot reuse operation',async()=>{
   assert.equal((await rpc('rpc_transfer_order',args)).replayed,true);
   await assert.rejects(rpc('rpc_transfer_order',[...args.slice(0,4),'Changed reason']),/IDEMPOTENCY_KEY_REUSED/);
   await actor(owner);await assert.rejects(rpc('rpc_transfer_order',args),/IDEMPOTENCY_KEY_REUSED/);
   const audit=(await db.query("SELECT * FROM public.audit_logs WHERE action_key='pos.order.transferred' AND entity_id=$1",[order.order_id])).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_user_id,staff);assert.equal(audit[0].before_state.position_id,a);assert.equal(audit[0].after_state.reason,args[4]);
  });
  await t.test('occupied, inactive, foreign and same tables leave the source unchanged',async()=>{
   const attempt=dest=>rpc('rpc_transfer_order',[order.order_id,moved.revision,dest,randomUUID(),'Test transfer']);
   await assert.rejects(rpc('rpc_transfer_order',delayed),/POSITION_OCCUPIED/);
   await assert.rejects(attempt(c),/POSITION_OCCUPIED/);await assert.rejects(attempt(b),/SAME_POSITION/);await assert.rejects(attempt(randomUUID()),/POSITION_NOT_FOUND/);
   await db.exec('RESET ROLE');await db.query('UPDATE public.service_positions SET active=false WHERE id=$1',[a]);await actor(owner);await assert.rejects(attempt(a),/POSITION_NOT_FOUND/);
   const stored=(await db.query('SELECT position_id,revision FROM public.orders WHERE id=$1',[order.order_id])).rows[0];assert.equal(stored.position_id,b);assert.equal(stored.revision,2);
   await db.exec('RESET ROLE');await db.query('UPDATE public.service_positions SET active=true WHERE id=$1',[a]);await actor(owner);
  });
  await t.test('stale revisions, missing orders, invalid channels and reasons are rejected',async()=>{
   await assert.rejects(rpc('rpc_transfer_order',[order.order_id,1,a,randomUUID(),'Stale terminal']),/VERSION_CONFLICT/);
   await assert.rejects(rpc('rpc_transfer_order',[randomUUID(),1,a,randomUUID(),'Missing order']),/ORDER_NOT_FOUND/);
   await assert.rejects(rpc('rpc_transfer_order',[takeaway.order_id,1,a,randomUUID(),'Takeaway order']),/DINE_IN_REQUIRED/);
   await assert.rejects(rpc('rpc_transfer_order',[order.order_id,2,a,randomUUID(),' ']),/REASON_REQUIRED/);
   await assert.rejects(rpc('rpc_transfer_order',[order.order_id,null,a,randomUUID(),'No revision']),/INVALID_TRANSFER/);
  });
  await t.test('old save and payment snapshots conflict after transfer; paid orders cannot move',async()=>{
   const shift=await rpc('rpc_open_shift',[randomUUID(),0]);
   await assert.rejects(rpc('rpc_collect_payment',[order.order_id,shift.id,randomUUID(),1,'CASH',80000,false]),/VERSION_CONFLICT/);
   await assert.rejects(rpc('rpc_save_order',[randomUUID(),'DINE_IN',a,[{variant_id:variant,quantity:1}],{},order.order_id,1]),/VERSION_CONFLICT/);
   await rpc('rpc_collect_payment',[order.order_id,shift.id,randomUUID(),2,'CASH',80000,false]);
   await assert.rejects(rpc('rpc_transfer_order',[order.order_id,2,a,randomUUID(),'Paid order']),/ORDER_FINALIZED/);
   await actor(staff);assert.equal((await rpc('rpc_transfer_order',args)).replayed,true,'Original receipt survives payment');await actor(owner);
  });
  await t.test('occupied-table failure creates no receipt; same operation can succeed after freeing target',async()=>{
   const retry=delayed;const result=await rpc('rpc_transfer_order',retry);assert.equal(result.position_id,b);assert.equal(result.revision,2);
   const reused=[takeaway.order_id,1,c,retry[3],'Different payload'];await assert.rejects(rpc('rpc_transfer_order',reused),/IDEMPOTENCY_KEY_REUSED/);
  });
  await t.test('cross-store, tenant, revoked membership and anonymous access are denied',async()=>{
   await actor(other);await assert.rejects(rpc('rpc_transfer_order',args),/PERMISSION_DENIED/);
   await actor(staff);await assert.rejects(rpc('rpc_transfer_order',args,foreign.store_id),/PERMISSION_DENIED/);
   await assert.rejects(db.query('SELECT * FROM public.order_transfer_requests'),/permission denied/);
   await db.exec('RESET ROLE');await db.query("UPDATE public.memberships SET status='SUSPENDED' WHERE organization_id=$1 AND user_id=$2",[w.organization_id,staff]);await actor(staff);await assert.rejects(rpc('rpc_transfer_order',args),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');await db.exec('SET ROLE anon');await assert.rejects(rpc('rpc_transfer_order',args),/permission denied/);
  });
 }finally{await db.close();}
});
