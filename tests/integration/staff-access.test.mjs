import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {AuthClient} from '../../public/assets/auth-client.mjs';

test('real Auth staff onboarding, session revocation and shift races',{timeout:90000},async()=>{
 const config=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const url=config.API_URL??config.api_url,key=config.ANON_KEY??config.anon_key,service=config.SERVICE_ROLE_KEY??config.service_role_key;
 assert.ok(url&&key&&service);assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname),'Local Supabase only');
 const user=async()=>{
  const email='staff-api-'+randomUUID().slice(0,8)+'@example.test',password=randomUUID();
  const response=await fetch(url+'/auth/v1/admin/users',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})});
  assert.ok(response.ok,'Create local Auth fixture: HTTP '+response.status);
  const client=new AuthClient({url,key});await client.signIn(email,password);return {client,email};
 };
 const {client:owner,email:ownerEmail}=await user(),{client:staff,email}=await user(),{client:other}=await user();
 const suffix=randomUUID().slice(0,8),w=await owner.bootstrap({name:'Staff API '+suffix,slug:'staff-api-'+suffix,storeName:'Main',address:'Test street'});
 const rpc=(client,name,args={})=>client.request('/rest/v1/rpc/'+name,{method:'POST',body:{p_org_id:w.organization_id,p_store_id:w.store_id,...args}});
 const token=randomBytes(32).toString('base64url'),invitationArgs={p_operation_id:randomUUID(),p_email:email,p_role:'CASHIER',p_token:token};
 const [first,second]=await Promise.all([rpc(owner,'rpc_create_staff_invitation',invitationArgs),rpc(owner,'rpc_create_staff_invitation',invitationArgs)]);
 assert.equal(first.id,second.id);assert.equal(first.token_hash,undefined);
 await assert.rejects(other.request('/rest/v1/rpc/rpc_accept_staff_invitation',{method:'POST',body:{p_token:token,p_full_name:'Wrong user'}}),/INVITATION_INVALID/);
 const accept=()=>staff.request('/rest/v1/rpc/rpc_accept_staff_invitation',{method:'POST',body:{p_token:token,p_full_name:'Thu ngân API'}});
 const [accepted,replay]=await Promise.all([accept(),accept()]);assert.equal(accepted.invitation_id,replay.invitation_id);
 assert.equal((await staff.stores()).length,1);assert.equal((await rpc(staff,'rpc_store_context')).can_manage_staff,false);
 await assert.rejects(rpc(staff,'rpc_store_staff_snapshot'),/PERMISSION_DENIED/);
 await assert.rejects(rpc(other,'rpc_store_staff_snapshot'),/PERMISSION_DENIED/);
 let snapshot=await rpc(owner,'rpc_store_staff_snapshot');assert.equal(snapshot.members.length,1);
 assert.equal(JSON.stringify(snapshot).includes(token),false);assert.equal(JSON.stringify(snapshot).includes('token_hash'),false);
 let revision=snapshot.members[0].revision;
 const change=(active,role='CASHIER',operation=randomUUID(),expected=revision)=>rpc(owner,'rpc_set_store_staff',{p_operation_id:operation,p_user_id:staff.userId,p_role:role,p_active:active,p_expected_revision:expected,p_reason:'API staff assignment test'});
 // An in-flight shift request and access revocation must never both succeed.
 for(let i=0;i<4;i++){
  const [opened,disabled]=await Promise.allSettled([
   rpc(staff,'rpc_open_shift',{p_operation_id:randomUUID(),p_opening_amount:0}),change(false)
  ]);
  if(opened.status==='fulfilled'){
   assert.equal(disabled.status,'rejected');assert.match(disabled.reason.message,/STAFF_HAS_OPEN_WORK/);
   await rpc(staff,'rpc_close_shift',{p_operation_id:randomUUID(),p_shift_id:opened.value.id,p_counted_cash:0});
   revision=(await change(false)).revision;
  }else{
   assert.equal(disabled.status,'fulfilled');assert.match(opened.reason.message,/PERMISSION_DENIED/);
   revision=disabled.value.revision;
  }
  assert.equal((await staff.stores()).length,0,'Existing JWT loses store access');
  await accept();assert.equal((await staff.stores()).length,0,'Accepted-code replay cannot re-enable access');
  revision=(await change(true)).revision;
 }
 const upgradeOp=randomUUID(),oldRevision=revision;
 const upgraded=await change(true,'MANAGER',upgradeOp,oldRevision);revision=upgraded.revision;
 assert.equal((await change(true,'MANAGER',upgradeOp,oldRevision)).revision,revision);
 assert.equal((await rpc(staff,'rpc_store_context')).can_review_offline,true);
 assert.equal((await rpc(staff,'rpc_store_context')).can_manage_staff,false);
 await assert.rejects(change(true,'CASHIER',randomUUID(),oldRevision),/VERSION_CONFLICT/);
 revision=(await change(true)).revision;
 assert.equal((await rpc(staff,'rpc_store_context')).can_refund,false);
 await assert.rejects(rpc(staff,'rpc_refund_payment',{p_operation_id:randomUUID(),p_payment_id:randomUUID(),p_shift_id:randomUUID(),p_reason:'Forbidden test'}),/PERMISSION_DENIED/);
 await assert.rejects(rpc(owner,'rpc_set_store_staff',{p_operation_id:randomUUID(),p_user_id:owner.userId,p_role:'CASHIER',p_active:false,p_expected_revision:1,p_reason:'Protect the owner'}),/SELF_ACCESS_PROTECTED/);
 const revokedToken=randomBytes(32).toString('base64url');
 const revocable=await rpc(owner,'rpc_create_staff_invitation',{p_operation_id:randomUUID(),p_email:ownerEmail,p_role:'CASHIER',p_token:revokedToken});
 await Promise.all([rpc(owner,'rpc_revoke_staff_invitation',{p_invitation_id:revocable.id}),rpc(owner,'rpc_revoke_staff_invitation',{p_invitation_id:revocable.id})]);
 await assert.rejects(owner.request('/rest/v1/rpc/rpc_accept_staff_invitation',{method:'POST',body:{p_token:revokedToken,p_full_name:'Owner'}}),/INVITATION_INVALID/);
 await Promise.all([owner.signOut(),staff.signOut(),other.signOut()]);
});
