import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AuthClient } from '../../public/assets/auth-client.mjs';

// Only ephemeral local Supabase. Credentials stay in memory and are never logged.
test('real concurrent table transfers serialize with payment and preserve one receipt', {timeout:90000}, async()=>{
 let config;
 try{config=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
 catch{throw new Error('Local Supabase status unavailable');}
 const url=config.API_URL??config.api_url;
 const key=config.ANON_KEY??config.anon_key;
 const service=config.SERVICE_ROLE_KEY??config.service_role_key;
 assert.ok(url&&key&&service,'Local Supabase test credentials are available');
 assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'Refuse to seed a remote Supabase project');
 const makeClient=async()=>{
  const suffix=randomUUID().slice(0,8),email=`smoke-${suffix}@example.test`,password=randomUUID();
  const response=await fetch(`${url}/auth/v1/admin/users`,{method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})});
  assert.ok(response.ok,`Create local Auth fixture: HTTP ${response.status}`);
  const client=new AuthClient({url,key});await client.signIn(email,password);
  const workspace=await client.bootstrap({name:`Test ${suffix}`,slug:`test-${suffix}`,storeName:'Main',address:'123 Local Test'});
  return {client,workspace};
 };
 const {client:a,workspace:w}=await makeClient();
 const {client:b}=await makeClient();
 assert.equal((await a.organizations()).length,1);
 assert.equal((await b.organizations()).length,1);
 assert.equal((await a.stores())[0].id,w.store_id);
 const rpc=(name,args={})=>a.request(`/rest/v1/rpc/${name}`,{method:'POST',body:{p_org_id:w.organization_id,p_store_id:w.store_id,...args}});
 const product=await rpc('rpc_create_product',{p_product:{name:'Transfer coffee',variants:[{name:'M',price:35000}],modifiers:[]}});
 const variant=(await a.request('/rest/v1/product_variants?select=id&product_id=eq.'+product))[0].id;
 const tables=await Promise.all(['A','B','C','D'].map(p_name=>rpc('rpc_create_position',{p_name})));
 const save=p_position_id=>rpc('rpc_save_order',{p_operation_id:randomUUID(),p_channel:'DINE_IN',p_position_id,p_items:[{variant_id:variant,quantity:1}],p_customer:{}});
 const order=await save(tables[0]);
 const args={p_order_id:order.order_id,p_expected_revision:order.revision,p_position_id:tables[1],p_operation_id:randomUUID(),p_reason:'Concurrent retry'};
 const [one,two]=await Promise.all([rpc('rpc_transfer_order',args),rpc('rpc_transfer_order',args)]);
 assert.equal(one.revision,2);assert.equal(two.revision,2);assert.ok(one.replayed||two.replayed);
 assert.equal((await a.request('/rest/v1/audit_logs?select=id&action_key=eq.pos.order.transferred&entity_id=eq.'+order.order_id)).length,1);
 const contender=await save(tables[0]);
 const race=await Promise.allSettled([rpc('rpc_transfer_order',{...args,p_expected_revision:2,p_position_id:tables[2],p_operation_id:randomUUID()}),rpc('rpc_transfer_order',{...args,p_order_id:contender.order_id,p_expected_revision:1,p_position_id:tables[2],p_operation_id:randomUUID()})]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.match(race.find(r=>r.status==='rejected').reason.message,/POSITION_OCCUPIED/);
 const occupying=await a.request('/rest/v1/orders?select=id&order_status=eq.OPEN&position_id=eq.'+tables[2]);assert.equal(occupying.length,1);
 const fresh=await rpc('rpc_create_position',{p_name:'Empty destination'});
 const payOrder=await save(tables[3]),shift=await rpc('rpc_open_shift',{p_operation_id:randomUUID(),p_opening_amount:0});
 // Exactly one of payment and transfer can consume revision 1. Destination is guaranteed empty.
 const outcome=await Promise.allSettled([rpc('rpc_transfer_order',{...args,p_order_id:payOrder.order_id,p_expected_revision:1,p_position_id:fresh,p_operation_id:randomUUID()}),rpc('rpc_collect_payment',{p_order_id:payOrder.order_id,p_expected_revision:1,p_shift_id:shift.id,p_operation_id:randomUUID(),p_method:'CASH',p_received_amount:35000,p_transfer_confirmed:false})]);
 if(outcome[0].status==='fulfilled'){
  assert.equal(outcome[1].status,'rejected');assert.match(outcome[1].reason.message,/VERSION_CONFLICT/);
 }else{
  assert.equal(outcome[1].status,'fulfilled');assert.match(outcome[0].reason.message,/ORDER_FINALIZED/);
 }
 await assert.rejects(b.request('/rest/v1/rpc/rpc_transfer_order',{method:'POST',body:{p_org_id:w.organization_id,p_store_id:w.store_id,...args}}),/PERMISSION_DENIED/);
 await Promise.all([a.signOut(),b.signOut()]);
});
