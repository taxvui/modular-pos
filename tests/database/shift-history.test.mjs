import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';

test('shift reconciliation preserves cash, role boundaries and stable cursors',async t=>{
 const db=new PGlite(),owner=randomUUID(),other=randomUUID(),staff=randomUUID();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   GRANT USAGE ON SCHEMA auth TO authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec((await readFile('supabase/migrations/'+file,'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/,''));
  await db.query('INSERT INTO auth.users VALUES($1,$2,now()),($3,$4,now()),($5,$6,now())',[owner,'owner@shift.test',other,'other@shift.test',staff,'staff@shift.test']);
  const actor=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('SET ROLE authenticated');};
  const boot=async(id,slug)=>{await actor(id);return(await db.query('SELECT public.rpc_bootstrap_workspace($1,$2,$3,$4) d',[slug,slug,'Main','Test'])).rows[0].d;};
  const w=await boot(owner,'shift-a');await boot(other,'shift-b');await actor(owner);
  const rpc=async(name,args=[],store=w.store_id)=>(await db.query('SELECT public.'+name+'('+['$1','$2',...args.map((_,i)=>'$'+(i+3))].join(',')+') d',[w.organization_id,store,...args])).rows[0].d;
  const token=randomBytes(32).toString('base64url');await rpc('rpc_create_staff_invitation',[randomUUID(),'staff@shift.test','CASHIER',token]);
  const product=await rpc('rpc_create_product',[{name:'Coffee',variants:[{name:'M',price:35000}],modifiers:[]}]);
  const variant=(await db.query('SELECT id FROM public.product_variants WHERE product_id=$1',[product])).rows[0].id;
  await actor(staff);await db.query('SELECT public.rpc_accept_staff_invitation($1,$2)',[token,'Thu ngân']);
  const shift=await rpc('rpc_open_shift',[randomUUID(),100000]);
  const pay=async(quantity,method,received)=>{const order=await rpc('rpc_save_order',[randomUUID(),'TAKEAWAY',null,[{variant_id:variant,quantity,modifier_ids:[]}],{},null,null]);return rpc('rpc_collect_payment',[order.order_id,shift.id,randomUUID(),order.revision,method,received,method==='TRANSFER']);};
  const cash=await pay(2,'CASH',100000),bank=await pay(1,'TRANSFER',35000);
  await rpc('rpc_close_shift',[shift.id,randomUUID(),170000]);
  await t.test('cash change and transfers reconcile independently against the saved close',async()=>{
   const s=await rpc('rpc_shift_summary',[shift.id]);assert.equal(s.totals.cash_sales,70000);assert.equal(s.totals.cash_received,100000);assert.equal(s.totals.change_given,30000);assert.equal(s.totals.transfer_sales,35000);assert.equal(s.totals.expected_cash,170000);assert.equal(s.shift.counted_cash,170000);assert.equal(s.shift.difference,0);
  });
  await actor(owner);const refundShift=await rpc('rpc_open_shift',[randomUUID(),100000]);
  await t.test('empty shift totals are zero; later refunds affect only the refund shift',async()=>{
   assert.equal((await rpc('rpc_shift_summary',[refundShift.id])).totals.payment_count,0);
   await rpc('rpc_refund_payment',[cash.id,refundShift.id,randomUUID(),'Cash refund later']);await rpc('rpc_refund_payment',[bank.id,refundShift.id,randomUUID(),'Bank refund later']);
   const a=await rpc('rpc_shift_summary',[shift.id]),b=await rpc('rpc_shift_summary',[refundShift.id]);
   assert.equal(a.totals.refund_count,0);assert.equal(a.totals.expected_cash,170000);assert.equal(a.shift.expected_cash,170000);
   assert.equal(b.totals.cash_refunds,70000);assert.equal(b.totals.transfer_refunds,35000);assert.equal(b.totals.expected_cash,30000);assert.equal(b.totals.net_collections,-105000);
   const events=await rpc('rpc_shift_transactions',[refundShift.id]);assert.equal(events.transactions.length,2);assert.ok(events.transactions.every(e=>e.kind==='REFUND'));assert.ok(events.transactions.some(e=>e.payment_id===cash.id));
  });
  await t.test('cashier sees own shifts while manager sees the entire store',async()=>{
   const all=await rpc('rpc_shift_history');assert.equal(all.scope,'STORE');assert.equal(all.shifts.length,2);
   await actor(staff);const own=await rpc('rpc_shift_history');assert.equal(own.scope,'OWN');assert.deepEqual(own.shifts.map(s=>s.id),[shift.id]);
   await assert.rejects(rpc('rpc_shift_summary',[refundShift.id]),/PERMISSION_DENIED/);await assert.rejects(rpc('rpc_shift_transactions',[refundShift.id]),/PERMISSION_DENIED/);
   await assert.rejects(db.query('SELECT public.shift_history_access($1,$2,$3)',[w.organization_id,w.store_id,shift.id]),/permission denied/);await actor(owner);
  });
  await t.test('date, status and partial cursors are rejected',async()=>{
   for(const args of [['2026-01-01','2026-10-20'],['2026-10-21','2026-10-20'],[null,null,'BAD'],[null,null,'ALL',null,randomUUID()]])await assert.rejects(rpc('rpc_shift_history',args),/INVALID_SHIFT_FILTER/);
   for(const args of [[null,'PAYMENT',null],['2026-10-20',null,randomUUID()],['2026-10-20','BAD',randomUUID()]])await assert.rejects(rpc('rpc_shift_transactions',[shift.id,...args]),/INVALID_SHIFT_FILTER/);
   await assert.rejects(rpc('rpc_shift_summary',[randomUUID()]),/SHIFT_NOT_FOUND/);
  });
  const seed=async at=>(await db.query("INSERT INTO public.cash_shifts(organization_id,store_id,opened_by,opening_amount,opened_at,closed_at,expected_cash,counted_cash,difference,open_operation_id) VALUES($1,$2,$3,0,$4,$4,0,0,0,$5) RETURNING id",[w.organization_id,w.store_id,owner,at,randomUUID()])).rows[0].id;
  await t.test('opening date uses store timezone boundaries',async()=>{
   await db.exec('RESET ROLE');for(const at of ['2026-10-19T16:59:59Z','2026-10-19T17:00:00Z','2026-10-20T16:59:59Z','2026-10-20T17:00:00Z'])await seed(at);await actor(owner);
   const page=await rpc('rpc_shift_history',['2026-10-20','2026-10-20','CLOSED']);assert.equal(page.shifts.length,2);assert.equal(page.timezone,'Asia/Ho_Chi_Minh');
  });
  await t.test('tied timestamps paginate shifts without duplicates after a new insert',async()=>{
   await db.exec('RESET ROLE');for(let i=0;i<53;i++)await seed('2026-10-18T08:00:00Z');await actor(owner);
   const args=['2026-10-18','2026-10-18','CLOSED'],first=await rpc('rpc_shift_history',args);assert.equal(first.shifts.length,50);
   await db.exec('RESET ROLE');await seed('2026-10-18T09:00:00Z');await actor(owner);
   const second=await rpc('rpc_shift_history',[...args,first.next_cursor.time,first.next_cursor.id]);assert.equal(second.shifts.length,3);assert.equal(second.next_cursor,null);assert.equal(new Set([...first.shifts,...second.shifts].map(s=>s.id)).size,53);
  });
  await t.test('ledger keyset handles tied payment and refund timestamps',async()=>{
   await db.exec('RESET ROLE');const ledger=await seed('2026-10-17T08:00:00Z');
   for(let i=0;i<53;i++){
    const order=(await db.query("INSERT INTO public.orders(organization_id,store_id,channel,created_by) VALUES($1,$2,'TAKEAWAY',$3) RETURNING id",[w.organization_id,w.store_id,owner])).rows[0].id;
    const payment=(await db.query("INSERT INTO public.payments(organization_id,store_id,order_id,shift_id,method,amount,received_amount,change_amount,actor_id,created_at) VALUES($1,$2,$3,$4,'CASH',1,1,0,$5,'2026-10-17T08:00:00Z') RETURNING id",[w.organization_id,w.store_id,order,ledger,owner])).rows[0].id;
    if(i===0)await db.query("INSERT INTO public.refunds(organization_id,store_id,payment_id,shift_id,amount,method,reason,actor_id,created_at) VALUES($1,$2,$3,$4,1,'CASH','Test refund',$5,'2026-10-17T08:00:00Z')",[w.organization_id,w.store_id,payment,ledger,owner]);
   }
   await actor(owner);const first=await rpc('rpc_shift_transactions',[ledger]);assert.equal(first.transactions.length,50);assert.equal(first.transactions[0].kind,'REFUND');
   const c=first.next_cursor,second=await rpc('rpc_shift_transactions',[ledger,c.time,c.kind,c.id]);assert.equal(second.transactions.length,4);assert.equal(second.next_cursor,null);assert.equal(new Set([...first.transactions,...second.transactions].map(e=>e.kind+e.id)).size,54);
  });
  await t.test('foreign store, tenant, anonymous and revoked membership cannot read',async()=>{
   await db.exec('RESET ROLE');const second=(await db.query("INSERT INTO public.stores(organization_id,code,name,address) VALUES($1,'SECOND','Second','Test') RETURNING id",[w.organization_id])).rows[0].id;
   await actor(staff);await assert.rejects(rpc('rpc_shift_history',[],second),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');await db.query("UPDATE public.memberships SET status='SUSPENDED' WHERE organization_id=$1 AND user_id=$2",[w.organization_id,staff]);await actor(staff);await assert.rejects(rpc('rpc_shift_summary',[shift.id]),/PERMISSION_DENIED/);
   await actor(other);await assert.rejects(rpc('rpc_shift_history'),/PERMISSION_DENIED/);await assert.rejects(rpc('rpc_shift_transactions',[shift.id]),/PERMISSION_DENIED/);
   await db.exec('RESET ROLE');await db.exec('SET ROLE anon');await assert.rejects(rpc('rpc_shift_summary',[shift.id]),/permission denied/);
  });
 }finally{await db.close();}
});
