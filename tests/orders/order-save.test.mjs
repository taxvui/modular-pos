import test from 'node:test';
import assert from 'node:assert/strict';
import {saveOrderDurably} from '../../public/assets/order-save.mjs';
const payload={p_channel:'TAKEAWAY',p_items:[{variant_id:'coffee',quantity:2}],p_customer:{name:'Khách'},p_order_id:null,p_expected_revision:null};
const ack={order_id:'order',revision:1,total_amount:70000,status:'OPEN'};
function fixture(){
 const events=[];let stored=null;
 const queue={beginSave:async(body,id,display)=>{events.push('persist');stored={payload:structuredClone(body),operationId:id,display:structuredClone(display)};return stored;},finishSave:async id=>{assert.equal(id,stored.operationId);events.push('forget');stored=null;}};
 return {queue,events,pending:()=>stored};
}
test('persist precedes transmission, retry uses stored payload and acknowledgement precedes deletion',async()=>{
 const f=fixture();let sent;
 const result=await saveOrderDurably(f.queue,payload,'stable',{cart:['coffee']},async(body,id)=>{f.events.push('send');sent={body,id};return ack;});
 assert.deepEqual(f.events,['persist','send','forget']);assert.deepEqual(sent,{body:payload,id:'stable'});assert.equal(result.order_id,'order');assert.equal(f.pending(),null);
});
test('local persistence failure prevents any transmission',async()=>{
 let called=false;
 await assert.rejects(saveOrderDurably({beginSave:async()=>{throw Error('LOCAL_WRITE_FAILED');}},payload,'stable',{},async()=>{called=true;}),/LOCAL_WRITE_FAILED/);
 assert.equal(called,false);
});
test('unknown delivery outcomes and auth failures retain the original operation',async()=>{
 for(const error of [new TypeError('Network'),Object.assign(Error('HTTP_500'),{status:500}),Object.assign(Error('AUTH_REQUIRED'),{status:401}),Error('PERMISSION_DENIED'),Error('SESSION_CHANGED'),Error('IDEMPOTENCY_KEY_REUSED')]){
  const f=fixture();await assert.rejects(saveOrderDurably(f.queue,payload,'stable',{},async()=>{throw error;}));
  assert.equal(f.pending().operationId,'stable');assert.deepEqual(f.pending().payload,payload);assert.deepEqual(f.events,['persist']);
 }
});
test('definitive server rejections release the operation so the cart can be corrected',async()=>{
 for(const code of ['VERSION_CONFLICT','ORDER_FINALIZED','VARIANT_UNAVAILABLE','23505','DELIVERY_DETAILS_REQUIRED']){
  const f=fixture();await assert.rejects(saveOrderDurably(f.queue,payload,'stable',{},async()=>{throw Error(code);}));assert.equal(f.pending(),null);
 }
});
test('malformed or mismatched acknowledgements never forget the operation',async()=>{
 for(const result of [null,{}, {...ack,revision:null},{...ack,total_amount:null},{...ack,total_amount:-1},{status:'CANCELLED'},{status:'REVIEW_REQUIRED',operation_id:'other',review_id:'review'}]){
  const f=fixture();await assert.rejects(saveOrderDurably(f.queue,payload,'stable',{},async()=>result),/INVALID_SERVER_ACK/);assert.ok(f.pending());
 }
 const f=fixture();await assert.rejects(saveOrderDurably(f.queue,{...payload,p_order_id:'existing'},'stable',{},async()=>ack),/INVALID_SERVER_ACK/);
});
test('lost local deletion acknowledgement retains intent for idempotent retry',async()=>{
 const f=fixture();f.queue.finishSave=async()=>{throw Error('LOCAL_WRITE_FAILED');};
 await assert.rejects(saveOrderDurably(f.queue,payload,'stable',{},async()=>ack),/LOCAL_WRITE_FAILED/);assert.equal(f.pending().operationId,'stable');
});
test('review/cancellation receipts must belong to the exact submitted operation',async()=>{
 for(const status of ['REVIEW_REQUIRED','CANCELLED']){const f=fixture();await saveOrderDurably(f.queue,payload,'stable',{},async()=>({status,operation_id:'stable',review_id:'review'}));assert.equal(f.pending(),null);}
});
