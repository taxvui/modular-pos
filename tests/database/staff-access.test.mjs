import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

test('store staff invitations and access changes enforce scoped permissions',async t=>{
 const db=new PGlite(),owner=randomUUID(),other=randomUUID(),staff=randomUUID(),pending=randomUUID();
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for(const name of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec((await readFile('supabase/migrations/'+name,'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/,''));
  await db.query('INSERT INTO auth.users VALUES($1,$2,now()),($3,$4,now()),($5,$6,now()),($7,$8,NULL)',[owner,'owner@example.test',other,'other@example.test',staff,'staff@example.test',pending,'pending@example.test']);
  const actor=async id=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('SET ROLE authenticated');};
  const boot=async(id,name)=>{await actor(id);return(await db.query('SELECT public.rpc_bootstrap_workspace($1,$2,$3,$4) AS d',[name,name,'Main','Test street'])).rows[0].d;};
  const a=await boot(owner,'staff-a');await boot(other,'staff-b');
  await db.exec('RESET ROLE');
  const second=(await db.query("INSERT INTO public.stores(organization_id,code,name,address) VALUES($1,'SECOND','Second','Test') RETURNING id",[a.organization_id])).rows[0].id;
  const rpc=async(name,args,store=a.store_id)=>(await db.query('SELECT public.'+name+'('+['$1','$2',...args.map((_,i)=>'$'+(i+3))].join(',')+') AS d',[a.organization_id,store,...args])).rows[0].d;
  const create=(email='staff@example.test',role='CASHIER',token=randomBytes(32).toString('base64url'),operation=randomUUID(),store=a.store_id)=>rpc('rpc_create_staff_invitation',[operation,email,role,token],store);
  const accept=(token,name='Thu ngân')=>db.query('SELECT public.rpc_accept_staff_invitation($1,$2) AS d',[token,name]).then(r=>r.rows[0].d);
  const context=store=>db.query('SELECT public.rpc_store_context($1,$2) AS d',[a.organization_id,store]).then(r=>r.rows[0].d);
  const change=(role,active,revision,operation=randomUUID(),user=staff)=>rpc('rpc_set_store_staff',[operation,user,role,active,revision,'Điều chỉnh phân công cửa hàng']);
  const token=randomBytes(32).toString('base64url'),operation=randomUUID();let invitation,revision=1;
  await actor(owner);
  await t.test('creation is idempotent and neither metadata nor snapshots return a token verifier',async()=>{
   invitation=await create(' STAFF@example.test ','CASHIER',token,operation);
   assert.equal(invitation.email,'staff@example.test');assert.equal(invitation.token_hash,undefined);
   assert.equal((await create('staff@example.test','CASHIER',token,operation)).id,invitation.id);
   await assert.rejects(create('staff@example.test','MANAGER',token,operation),/IDEMPOTENCY_KEY_REUSED/);
   await assert.rejects(create(),/INVITATION_ALREADY_OPEN/);
   const snapshot=await rpc('rpc_store_staff_snapshot',[]);
   assert.equal(JSON.stringify(snapshot).includes(token),false);assert.equal(JSON.stringify(snapshot).includes('token_hash'),false);
   await db.exec('RESET ROLE');
   assert.equal((await db.query('SELECT token_hash FROM public.staff_invitations WHERE id=$1',[invitation.id])).rows[0].token_hash,createHash('sha256').update(token).digest('hex'));
   await actor(owner);
  });
  await t.test('another verified email and an unverified account cannot redeem the code',async()=>{
   await actor(other);await assert.rejects(accept(token),/INVITATION_INVALID/);
   await assert.rejects(rpc('rpc_store_staff_snapshot',[]),/PERMISSION_DENIED/);
   await actor(pending);await assert.rejects(accept(token),/EMAIL_VERIFICATION_REQUIRED/);
  });
  await t.test('joining a cashier role creates only store-specific access',async()=>{
   await actor(staff);assert.equal((await accept(token)).store_id,a.store_id);
   assert.equal((await accept(token)).status,'ACCEPTED');
   const c=await context(a.store_id);assert.equal(c.can_sell,true);assert.equal(c.can_collect,true);assert.equal(c.can_manage_shift,true);
   for(const key of ['can_manage_catalog','can_refund','can_void','can_report','can_review_offline','can_manage_staff'])assert.equal(c[key],false,key);
   await assert.rejects(context(second),/STORE_ACCESS_DENIED/);
   await assert.rejects(create('new@example.test'),/PERMISSION_DENIED/);
   await assert.rejects(change('MANAGER',true,1),/PERMISSION_DENIED/);
   await assert.rejects(db.query('SELECT * FROM public.staff_invitations'),/permission denied/);
   await assert.rejects(db.query('UPDATE public.user_roles SET role_id=role_id'),/permission denied/);
  });
  await t.test('owner upgrades once; cashier session sees new rights without becoming staff admin',async()=>{
   await actor(owner);const op=randomUUID();const upgraded=await change('MANAGER',true,1,op);revision=upgraded.revision;
   assert.equal((await change('MANAGER',true,1,op)).revision,revision);
   await assert.rejects(change('CASHIER',true,1),/VERSION_CONFLICT/);
   await actor(staff);const c=await context(a.store_id);assert.equal(c.can_refund,true);assert.equal(c.can_review_offline,true);assert.equal(c.can_manage_staff,false);
  });
  await t.test('disabling waits for open cash work and owner access cannot be replaced',async()=>{
   await actor(staff);const shift=(await rpc('rpc_open_shift',[randomUUID(),100000])).id;
   await actor(owner);await assert.rejects(change('MANAGER',false,revision),/STAFF_HAS_OPEN_WORK/);
   await assert.rejects(change('CASHIER',false,1,randomUUID(),owner),/SELF_ACCESS_PROTECTED/);
   await assert.rejects(change('OWNER',true,revision),/INVALID_STAFF_ROLE/);
   await actor(staff);await rpc('rpc_close_shift',[shift,randomUUID(),100000]);
  });
  await t.test('pending offline reviews block revocation until their durable cancellation',async()=>{
   const request={p_channel:'TAKEAWAY',p_position_id:null,p_items:[{variant_id:randomUUID(),quantity:1}],p_customer:{},p_expected_total:1000,p_shift_id:null,p_payment_operation_id:null,p_received_amount:null};
   await actor(staff);const operation=randomUUID();const review=await rpc('rpc_submit_offline_review',[operation,request,'Khách yêu cầu hủy đơn']);
   await actor(owner);await assert.rejects(change('CASHIER',false,revision),/STAFF_HAS_OPEN_WORK/);
   await rpc('rpc_cancel_offline_review',[review.review_id,randomUUID(),'Đã đối soát, chưa thu tiền',false]);
  });
  await t.test('second-store access survives revocation at the first store',async()=>{
   await actor(owner);const secondToken=randomBytes(32).toString('base64url');await create('staff@example.test','CASHIER',secondToken,randomUUID(),second);
   await actor(staff);await accept(secondToken);assert.equal((await context(second)).can_sell,true);
   await actor(owner);revision=(await change('CASHIER',false,revision)).revision;
   await actor(staff);await assert.rejects(context(a.store_id),/STORE_ACCESS_DENIED/);assert.equal((await context(second)).can_sell,true);
   assert.equal((await accept(token)).status,'ACCEPTED');await assert.rejects(context(a.store_id),/STORE_ACCESS_DENIED/,'Old code replay must not restore revoked access');
  });
  await t.test('an administrative change revokes pending invitations that could restore old rights',async()=>{
   await actor(owner);const staleToken=randomBytes(32).toString('base64url');const stale=await create('staff@example.test','MANAGER',staleToken);
   revision=(await change('CASHIER',false,revision)).revision;
   assert.equal((await rpc('rpc_store_staff_snapshot',[])).invitations.find(r=>r.id===stale.id).status,'REVOKED');
   await actor(staff);await assert.rejects(accept(staleToken),/INVITATION_INVALID/);
  });
  await t.test('re-enable and downgrade change real permissions in the existing session',async()=>{
   await actor(owner);revision=(await change('CASHIER',true,revision)).revision;
   await actor(staff);const c=await context(a.store_id);assert.equal(c.can_sell,true);assert.equal(c.can_review_offline,false);assert.equal(c.can_refund,false);
   await actor(owner);const snapshot=await rpc('rpc_store_staff_snapshot',[]);assert.equal(snapshot.members[0].revision,revision);assert.equal(snapshot.members[0].full_name,'Thu ngân');
  });
  await t.test('revoked, expired and owner-target codes never assign roles',async()=>{
   await actor(owner);const revokeToken=randomBytes(32).toString('base64url');const invite=await create('other@example.test','CASHIER',revokeToken);
   await rpc('rpc_revoke_staff_invitation',[invite.id]);await rpc('rpc_revoke_staff_invitation',[invite.id]);
   await actor(other);await assert.rejects(accept(revokeToken),/INVITATION_INVALID/);
   await actor(owner);const expiredToken=randomBytes(32).toString('base64url');const expired=await create('other@example.test','CASHIER',expiredToken);
   await db.exec('RESET ROLE');await db.query("UPDATE public.staff_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
   await actor(other);await assert.rejects(accept(expiredToken),/INVITATION_INVALID/);
   await actor(owner);const ownerToken=randomBytes(32).toString('base64url');await create('owner@example.test','CASHIER',ownerToken);
   await assert.rejects(accept(ownerToken),/OWNER_ACCESS_PROTECTED/);
  });
 }finally{await db.close();}
});
