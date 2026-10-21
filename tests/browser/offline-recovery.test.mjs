import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

async function fixture() {
 const state={outage:0,user:'user-a',version:'v1',breakInstall:false,htmlError:false,sync:[],reviews:[],allowReview:false,cancelCalls:[],reviewReadOutage:false,activeToken:'secret-session-token',rejectedToken:null,refreshCalls:[],refreshFailure:0,saveCalls:[],savedOrders:[]};
 const root=path.resolve('public');
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(pathname.startsWith('/backend/')){
   let body='';for await(const chunk of req)body+=chunk;
   body=body?JSON.parse(body):{};
   if(pathname.includes('/token')){
    if(new URL(req.url,'http://local').searchParams.get('grant_type')==='refresh_token'){
     state.refreshCalls.push(body);
     if(state.refreshFailure)return json({error_code:'refresh_token_not_found'},state.refreshFailure);
     state.activeToken='secret-rotated-token';
     return json({access_token:state.activeToken,refresh_token:'secret-rotated-refresh',expires_in:3600,user:{id:state.user,email:'owner@example.test'}});
    }
    state.activeToken='secret-session-token';return json({access_token:state.activeToken,refresh_token:'secret-refresh-token',expires_in:3600,user:{id:state.user,email:'owner@example.test'}});
   }
   if(pathname.endsWith('/logout'))return json({});
   if(req.headers.authorization!=='Bearer '+state.activeToken||req.headers.authorization==='Bearer '+state.rejectedToken)return json({message:'AUTH_REQUIRED'},401);
   if(pathname.endsWith('/organizations'))return json([{id:'org',name:'Cafe'}]);
   if(pathname.endsWith('/stores'))return json([{id:'store',organization_id:'org',name:'Cafe',code:'MAIN'}]);
   if(pathname.endsWith('/rpc_store_context'))return json({can_sell:true,can_manage_catalog:true,can_manage_shift:true,can_collect:true,can_review_offline:state.allowReview});
   if(pathname.endsWith('/rpc_submit_offline_review')){
    let review=state.reviews.find(r=>r.operation_id===body.p_operation_id);
    if(!review){review={id:'review-'+state.reviews.length,operation_id:body.p_operation_id,actor_id:state.user,sender_name:'Thu ngân',request_payload:body.p_request,item_labels:[{name:'Cà phê / M'}],note:body.p_note,created_at:new Date().toISOString(),status:'OPEN',result:{}};state.reviews.push(review);}
    return json({review_id:review.id,operation_id:review.operation_id,status:review.status,result:review.result});
   }
   if(pathname.endsWith('/rpc_cancel_offline_review')){
    state.cancelCalls.push(body);
    if(!state.allowReview)return json({message:'PERMISSION_DENIED'},403);
    const review=state.reviews.find(r=>r.id===body.p_review_id);
    if(review.request_payload.p_received_amount!==null&&!body.p_cash_refunded)return json({message:'CASH_REFUND_CONFIRMATION_REQUIRED'},400);
    if(review.status==='CANCELLED'){
     assert.equal(body.p_operation_id,review.resolution_operation_id,'Lost-response retry preserves the manager operation ID');
     return json(review.result);
    }
    review.status='CANCELLED';review.resolution_operation_id=body.p_operation_id;
    review.result={review_id:review.id,operation_id:review.operation_id,status:'CANCELLED',reason:body.p_reason,cash_refund_amount:review.request_payload.p_received_amount===null?0:review.request_payload.p_expected_total};
    return json(review.result);
   }
   if(pathname.endsWith('/offline_sale_reviews')){
    if(state.reviewReadOutage)return json({message:'Unavailable'},503);
    const params=new URL(req.url,'http://local').searchParams;
    let rows=state.reviews.filter(r=>state.allowReview||r.actor_id===state.user);
    if(params.get('actor_id'))rows=rows.filter(r=>'eq.'+r.actor_id===params.get('actor_id'));
    if(params.get('status'))rows=rows.filter(r=>'eq.'+r.status===params.get('status'));
    if(params.get('operation_id'))rows=rows.filter(r=>params.get('operation_id').slice(4,-1).split(',').includes(r.operation_id));
    const offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||1000);
    return json(rows.slice(offset,offset+limit));
   }
   if(state.outage&&state.htmlError){res.writeHead(state.outage,{'Content-Type':'text/html'}).end('<h1>Gateway unavailable</h1>');return;}
   if(state.outage)return json({code:'PGRST000',message:state.outage===403?'PERMISSION_DENIED':'Unavailable'},state.outage);
   if(pathname.endsWith('/rpc_save_order')){
    state.saveCalls.push(body);let order=state.savedOrders.find(row=>row.operation_id===body.p_operation_id);
    if(!order){order={id:'saved-'+state.savedOrders.length,operation_id:body.p_operation_id,channel:body.p_channel,order_status:'OPEN',customer:body.p_customer,total_amount:35000,revision:1};state.savedOrders.push(order);}
    return json({order_id:order.id,revision:order.revision,total_amount:order.total_amount,status:'OPEN'});
   }
   if(pathname.endsWith('/orders'))return json(state.savedOrders);
   if(pathname.endsWith('/order_items'))return json([{variant_id:'coffee-m',product_name:'Cà phê',variant_name:'M',quantity:1,unit_amount:35000,modifier_snapshot:[]}]);
   if(pathname.endsWith('/products'))return json([{id:'coffee',name:'Cà phê',category:'Nước',active:true}]);
   if(pathname.endsWith('/product_variants'))return json([{id:'coffee-m',product_id:'coffee',name:'M',price:35000,active:true}]);
   if(pathname.endsWith('/rpc_sync_offline_sale')){state.sync.push(body);return json({order_id:'synced-order',operation_id:body.p_operation_id});}
   return json([]);
  }
  if(pathname==='/app-config.js'){
   res.setHeader('Content-Type','application/javascript');
   res.end(`window.MODULAR_POS_CONFIG=${JSON.stringify({url:`http://127.0.0.1:${server.address().port}/backend`,key:'public-key'})};`);return;
  }
  if(pathname==='/account.html'&&!state.breakInstall){res.writeHead(308,{Location:'/account'}).end();return;}
  const pages=['/','/pos','/admin','/account','/login','/account.html'];
  const file=path.resolve(root,'.'+(pages.includes(pathname)?'/account.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  // Cache installation must fail as a whole if any shell asset cannot be fetched.
  if(state.breakInstall&&pathname==='/account.html'&&req.headers['sec-fetch-dest']!=='document'){res.writeHead(503).end();return;}
  try{
   let data=await readFile(file);
   if(pathname==='/sw.js')data=Buffer.from(data.toString().replace(/modular-pos-shell-[a-f0-9]+/,'modular-pos-shell-'+state.version));
   if(pages.includes(pathname))data=Buffer.from(data.toString().replace('<title>Tài khoản','<title>'+state.version+' Tài khoản'));
   res.setHeader('Content-Type',file.endsWith('.mjs')||file.endsWith('.js')?'application/javascript':'text/html');
   res.setHeader('Cache-Control','no-store');res.end(data);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{browser=await chromium.launch();}catch(error){await new Promise(r=>server.close(r));throw error;}
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();
 const origin=`http://127.0.0.1:${server.address().port}`;
 const login=async()=>{
  await page.locator('#email').fill('owner@example.test');
  await page.locator('#password').fill('correct-password');
  await page.locator('#loginForm button[type=submit]').click();
 };
 return {state,browser,context,page,origin,login,close:async()=>{await browser.close();await new Promise(r=>server.close(r));}};
}

test('cached shell reloads offline; catalog fallback is scoped and cannot bypass denied access',{timeout:90000},async()=>{
 const f=await fixture();const {page,context,state,origin,login}=f;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin+'/pos');
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  await login();await page.locator('#salesPanel').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('catalogStatus').textContent.startsWith('Đã tải menu'));
  // A fresh Auth/store-context check succeeds, but menu APIs fail during startup.
  state.outage=503;state.htmlError=true;
  await page.reload();
  await page.locator('#salesPanel').waitFor({state:'visible'});
  assert.match(await page.locator('#catalogStatus').textContent(),/dữ liệu lưu tại máy/);
  assert.match(await page.locator('#productChoice').textContent(),/Cà phê/);
  assert.equal(await page.locator('#financeArea').isVisible(),false);
  await page.locator('#addItem').click();await page.locator('#queueOrder').click();
  await page.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('1 đơn'));
  await page.locator('#outboxList summary').click();
  assert.match(await page.locator('#outboxList').textContent(),/Cà phê \/ M × 1/);
  const snapshots=await page.evaluate(async()=>{
   const {OfflineStore}=await import('/assets/offline-store.mjs');
   const q=new OfflineStore({url:location.origin+'/backend',userId:'user-a',organizationId:'org',storeId:'store'});
   return {snapshot:await q.cached(),records:await q.list()};
  });
  assert.equal(snapshots.snapshot.products[0].id,'coffee');
  assert.equal(JSON.stringify(snapshots).includes('secret-session-token'),false);
  const localId=snapshots.records[0].operationId;
  const cachedUrls=await page.evaluate(async()=>{
   const result=[];for(const key of await caches.keys())for(const request of await (await caches.open(key)).keys())result.push(request.url);return result;
  });
  assert.equal(cachedUrls.some(url=>url.includes('/backend/')),false,'API/Auth/customer responses never enter the shell cache');
  state.reviewReadOutage=true;await page.reload();
  await page.locator('#salesPanel').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('1 đơn'));
  assert.match(await page.locator('#salesStatus').textContent(),/Hàng đợi tại máy vẫn được giữ/);
  state.reviewReadOutage=false;
  await context.setOffline(true);await page.reload();
  await page.locator('#loginPanel').waitFor({state:'visible'});
  assert.equal(await page.locator('#salesPanel').isVisible(),false,'Offline reload does not restore an authenticated session');
  assert.match(await page.locator('#connectionStatus').textContent(),/Đang mất mạng/);
  assert.match(await page.title(),/v1/);
  await context.setOffline(false);state.outage=403;state.htmlError=false;
  await login();
  await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('chưa được cấp quyền'));
  assert.equal(await page.locator('#salesPanel').isVisible(),false,'Denied access cannot fall back to a cached catalog');
  // Reload starts a fresh online session; replay retains the original queued ID.
  state.outage=0;await page.reload();
  await page.locator('#salesPanel').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('1 đơn'));
  await page.locator('#syncOutbox').click();
  await page.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('0 đơn'));
  assert.equal(state.sync.length,1);assert.equal(state.sync[0].p_operation_id,localId);
  assert.equal(state.sync[0].display,undefined,'Display snapshots are not sent to the RPC');
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});
  state.user='user-b';state.outage=503;await login();
  await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Chưa xác nhận'));
  assert.equal(await page.locator('#salesPanel').isVisible(),false,'Another user cannot recover the previous user catalog');
  assert.deepEqual(errors,[]);
 }finally{await f.close();}
});

test('shell update waits for open tabs and failed installs leave no partial cache',{timeout:90000},async()=>{
 const f=await fixture();const {page,state,origin,context}=f;
 try{
  state.breakInstall=true;await page.goto(origin+'/pos');
  await page.waitForFunction(()=>document.getElementById('offlineReady').textContent.includes('Chưa lưu được'));
  assert.equal(await page.evaluate(async()=>(await caches.keys()).filter(key=>key.startsWith('modular-pos-shell-')).length),0);
  state.breakInstall=false;
  await page.reload();
  // Reload retries registration after the failed installation.
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  state.version='v2';
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
  await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting));
  assert.match(await page.title(),/v1/);
  await page.reload();assert.match(await page.title(),/v1/,'Existing tabs retain a consistent shell version');
  await page.close();
  const next=await context.newPage();await next.goto(origin+'/pos');
  await next.waitForFunction(()=>navigator.serviceWorker.controller);
  await next.reload();assert.match(await next.title(),/v2/);
  const keys=await next.evaluate(()=>caches.keys());
  assert.deepEqual(keys.filter(key=>key.startsWith('modular-pos-shell-')),['modular-pos-shell-v2']);
 }finally{await f.close();}
});


test('cashier proposes cancellation, manager confirms net refund and original device receives durable result',{timeout:90000},async()=>{
 const f=await fixture();const {page,state,origin,login}=f;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin+'/pos');await login();await page.locator('#salesPanel').waitFor({state:'visible'});
  assert.equal(await page.locator('#offlineReviewArea').isVisible(),false);
  const original=await page.evaluate(async()=>{
   const {OfflineStore}=await import('/assets/offline-store.mjs');
   const queue=new OfflineStore({url:location.origin+'/backend',userId:'user-a',organizationId:'org',storeId:'store'});
   const record=await queue.enqueue({p_channel:'TAKEAWAY',p_position_id:null,p_items:[{variant_id:'coffee-m',quantity:2}],p_customer:{name:'Khách A'},p_expected_total:70000,p_shift_id:'old-shift',p_payment_operation_id:crypto.randomUUID(),p_received_amount:100000},crypto.randomUUID(),{lines:[{name:'Cà phê / M',quantity:2,unit:35000}]});
   await queue.update(record,{status:'CONFLICT',error:'OPEN_SHIFT_REQUIRED'});return record;
  });
  await page.locator('#syncOutbox').click();
  await page.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('1 đơn'));
  await page.locator('#outboxList summary').click();
  await page.locator('#outboxList form input').fill('Ca cũ đã đóng, khách muốn hủy đơn');
  await page.route('**/backend/rest/v1/rpc/rpc_submit_offline_review',async route=>{await route.fetch();await route.abort('failed');},{times:1});
  await page.locator('#outboxList form button').click();
  await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Chưa xác nhận'));
  assert.deepEqual(state.reviews[0].request_payload,original.payload);
  assert.equal(state.reviews[0].request_payload.display,undefined);
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});
  state.user='manager';state.allowReview=true;await login();
  await page.locator('#salesPanel').waitFor({state:'visible'});
  await page.locator('#offlineReviewArea > summary').click();
  await page.locator('#reloadOfflineReviews').click();
  await page.locator('#offlineReviewList summary').click();
  const form=page.locator('#offlineReviewList form');
  assert.match(await page.locator('#offlineReviewList').textContent(),/Cà phê \/ M × 2/);
  await form.locator('input[name=reason]').fill('Khách đã nhận đủ tiền đơn');
  await form.locator('button').click();assert.equal(state.cancelCalls.length,0,'Cash refund confirmation is required');
  await form.locator('input[type=checkbox]').check();
  await page.route('**/backend/rest/v1/rpc/rpc_cancel_offline_review',async route=>{await route.fetch();await route.abort('failed');},{times:1});
  await form.locator('button').click();
  await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Chưa xác nhận'));
  await form.locator('button').click();
  await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Đã duyệt hủy'));
  assert.equal(state.cancelCalls.length,2);assert.equal(state.reviews[0].result.cash_refund_amount,70000);
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});
  state.user='user-a';state.allowReview=false;await login();
  await page.locator('#salesPanel').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('0 đơn'));
  assert.match(await page.locator('#outboxList').textContent(),/Đã hủy sau đối soát/);
  await page.locator('#syncOutbox').click();await page.locator('#retryOutbox').click();
  assert.equal(state.sync.length,0,'Cancelled record is never submitted as a new order');
  const stored=await page.evaluate(async()=>{
   const {OfflineStore}=await import('/assets/offline-store.mjs');
   return (await new OfflineStore({url:location.origin+'/backend',userId:'user-a',organizationId:'org',storeId:'store'}).list())[0];
  });
  assert.equal(stored.status,'CANCELLED');assert.deepEqual(stored.payload,original.payload);
  assert.deepEqual(errors,[]);
 }finally{await f.close();}
});


test('session refresh is shared; rejected refresh returns to login and preserves the scoped offline queue',{timeout:60000},async()=>{
 const f=await fixture(),{page,state,login}=f;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(f.origin+'/pos');await login();await page.locator('#salesPanel').waitFor({state:'visible'});
  await page.locator('#addItem').click();await page.locator('#queueOrder').click();
  await page.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('1 đơn'));
  state.rejectedToken=state.activeToken;
  await page.locator('#reloadOrders').click();
  await page.waitForFunction(()=>document.getElementById('salesStatus').textContent==='Đã tải dữ liệu mới nhất.');
  assert.equal(state.refreshCalls.length,1,'Parallel catalog requests share one refresh');
  assert.deepEqual(state.refreshCalls[0],{refresh_token:'secret-refresh-token'});
  state.rejectedToken=state.activeToken;state.refreshFailure=400;
  await page.locator('#reloadOrders').click();await page.locator('#loginPanel').waitFor({state:'visible'});
  assert.equal(await page.locator('#salesPanel').isVisible(),false);assert.equal(await page.locator('#workspacePanel').isVisible(),false);
  assert.equal(await page.locator('#identity').textContent(),'');assert.equal(await page.locator('#stores option').count(),0);
  assert.match(await page.locator('#status').textContent(),/đã hết hiệu lực/);
  const persisted=await page.evaluate(async()=>{
   const {OfflineStore}=await import('/assets/offline-store.mjs');
   return new OfflineStore({url:location.origin+'/backend',userId:'user-a',organizationId:'org',storeId:'store'}).list();
  });
  assert.equal(persisted.length,1);assert.equal(persisted[0].status,'PENDING');
  assert.equal(JSON.stringify(persisted).includes('secret-'),false);
  state.rejectedToken=null;state.refreshFailure=0;await login();await page.locator('#salesPanel').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('1 đơn'));
  await page.locator('#syncOutbox').click();await page.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('0 đơn'));
  assert.equal(state.sync.length,1);assert.equal(state.sync[0].p_operation_id,persisted[0].operationId);
  assert.deepEqual(errors,[]);
 }finally{await f.close();}
});


test('an online save survives a committed 500, reload and account switch without a new operation',{timeout:90000},async()=>{
 const f=await fixture(),{page,state,login}=f;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const journal=()=>page.evaluate(async()=>{
  const {OfflineStore}=await import('/assets/offline-store.mjs');return new OfflineStore({url:location.origin+'/backend',userId:'user-a',organizationId:'org',storeId:'store'}).pendingSave();
 });
 try{
  await page.goto(f.origin+'/pos');await login();await page.locator('#salesPanel').waitFor({state:'visible'});await page.locator('#addItem').click();await page.locator('#customerName').fill('Khách phục hồi');
  await page.route('**/rpc/rpc_save_order',async route=>{await route.fetch();await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Gateway lost acknowledgement'})});},{times:1});
  await page.locator('#saveOrder').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Chưa xác nhận'));
  const original=await journal();assert.equal(original.operationId,state.saveCalls[0].p_operation_id);assert.equal(state.savedOrders.length,1);
  assert.equal(await page.locator('#customerName').isDisabled(),true);assert.equal(await page.locator('#addItem').isDisabled(),true);assert.equal(await page.locator('#newOrder').isDisabled(),true);
  assert.equal(JSON.stringify(original).includes('secret-'),false);
  await page.reload();await page.locator('#saveRecoveryArea').waitFor({state:'visible'});assert.equal(await page.locator('#customerName').inputValue(),'Khách phục hồi');
  assert.equal((await journal()).operationId,original.operationId);
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});assert.equal(await page.locator('#saveRecoveryInfo').textContent(),'');
  state.user='user-b';await login();await page.locator('#salesPanel').waitFor({state:'visible'});assert.equal(await page.locator('#saveRecoveryArea').isVisible(),false);
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});state.user='user-a';await login();await page.locator('#saveRecoveryArea').waitFor({state:'visible'});
  await page.locator('#retryOrderSave').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.startsWith('Đã lưu đơn'));
  assert.equal(state.saveCalls.length,2);assert.deepEqual(state.saveCalls[0],state.saveCalls[1]);assert.equal(state.savedOrders.length,1);assert.equal(await journal(),null);assert.equal(await page.locator('#newOrder').isDisabled(),false);
  assert.deepEqual(errors,[]);
 }finally{await f.close();}
});

test('IndexedDB reserves one immutable intent across tabs and failed cleanup cannot remove a newer intent',{timeout:60000},async()=>{
 const f=await fixture(),{page}=f;
 try{
  await page.goto(f.origin+'/pos');const second=await f.context.newPage();await second.goto(f.origin+'/pos');
  const run=(target,id)=>target.evaluate(async id=>{
   const {OfflineStore}=await import('/assets/offline-store.mjs');const queue=new OfflineStore({url:location.origin+'/backend',userId:'user',organizationId:'org',storeId:'store'});
   try{return {record:await queue.beginSave({p_customer:{name:id}},id,{})};}catch(e){return {error:e.message};}
  },id);
  const results=await Promise.all([run(page,'a'),run(second,'b')]);assert.equal(results.filter(r=>r.record).length,1);assert.equal(results.filter(r=>r.error==='SAVE_RECOVERY_REQUIRED').length,1);
  const winner=results.find(r=>r.record).record;
  const result=await page.evaluate(async winner=>{
   const {OfflineStore}=await import('/assets/offline-store.mjs');const queue=new OfflineStore({url:location.origin+'/backend',userId:'user',organizationId:'org',storeId:'store'});
   await queue.finishSave(winner.operationId);await queue.beginSave({p_customer:{name:'new'}},'new',{});await queue.finishSave(winner.operationId);return queue.pendingSave();
  },winner);
  assert.equal(result.operationId,'new');
  const handed=await page.evaluate(async()=>{const {OfflineStore}=await import('/assets/offline-store.mjs');const q=new OfflineStore({url:location.origin+'/backend',userId:'user',organizationId:'org',storeId:'store'});await q.enqueue({p_customer:{name:'new'}},'new',{}, {finishSave:true});return {pending:await q.pendingSave(),sales:await q.list()};});
  assert.equal(handed.pending,null);assert.equal(handed.sales.length,1);assert.equal(handed.sales[0].operationId,'new');
 }finally{await f.close();}
});
