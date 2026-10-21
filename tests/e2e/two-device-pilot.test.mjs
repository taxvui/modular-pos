import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {AuthClient} from '../../public/assets/auth-client.mjs';

// Only disposable, local Supabase. No tokens, passwords or Auth responses in logs/artifacts.
async function fixture(){
 const config=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const url=config.API_URL??config.api_url,key=config.ANON_KEY??config.anon_key,service=config.SERVICE_ROLE_KEY??config.service_role_key;
 assert.ok(url&&key&&service);assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'Local Supabase only');
 const createUser=async()=>{
  const suffix=randomUUID().slice(0,8),email='pilot-'+suffix+'@example.test',password=randomUUID();
  const response=await fetch(url+'/auth/v1/admin/users',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})});
  assert.ok(response.ok,'Create local user: HTTP '+response.status);
  const client=new AuthClient({url,key});await client.signIn(email,password);return {email,password,client};
 };
 const owner=await createUser(),staff=await createUser(),suffix=randomUUID().slice(0,8);
 const workspace=await owner.client.bootstrap({name:'Pilot '+suffix,slug:'pilot-'+suffix,storeName:'Pilot Main',address:'Test street'});
 const rpc=(client,name,args={})=>client.request('/rest/v1/rpc/'+name,{method:'POST',body:{p_org_id:workspace.organization_id,p_store_id:workspace.store_id,...args}});
 const product=await rpc(owner.client,'rpc_create_product',{p_product:{name:'Cà phê pilot',category:'Nước',variants:[{name:'M',price:35000}],modifiers:[]}});
 const code=randomBytes(32).toString('base64url');
 await rpc(owner.client,'rpc_create_staff_invitation',{p_operation_id:randomUUID(),p_email:staff.email,p_role:'CASHIER',p_token:code});
 await staff.client.request('/rest/v1/rpc/rpc_accept_staff_invitation',{method:'POST',body:{p_token:code,p_full_name:'Thu ngân pilot'}});
 const root=path.resolve('public');
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname==='/app-config.js'){res.setHeader('Content-Type','application/javascript');res.end('window.MODULAR_POS_CONFIG='+JSON.stringify({url,key}));return;}
  const pages=['/','/pos','/account','/account.html','/login'];
  const file=path.resolve(root,'.'+(pages.includes(pathname)?'/account.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{const data=await readFile(file);res.setHeader('Content-Type',/\.(js|mjs)$/.test(file)?'application/javascript':file.endsWith('.json')?'application/json':'text/html');res.setHeader('Cache-Control','no-store');res.end(data);}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{browser=await chromium.launch();}catch(error){await new Promise(r=>server.close(r));throw error;}
 const contextA=await browser.newContext({viewport:{width:390,height:844}}),contextB=await browser.newContext({viewport:{width:1280,height:900}});
 const a=await contextA.newPage(),b=await contextB.newPage(),errors=[];
 for(const page of [a,b])page.on('pageerror',error=>errors.push(error.message));
 const origin='http://127.0.0.1:'+server.address().port;
 const login=async(page,account=staff)=>{
  await page.goto(origin+'/pos');await page.locator('#email').fill(account.email);await page.locator('#password').fill(account.password);await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#salesPanel').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.getElementById('reloadOrders').disabled);
 };
 return {url,owner,staff,workspace,product,rpc,contextA,a,b,errors,login,close:async()=>{await browser.close();await new Promise(r=>server.close(r));await Promise.allSettled([owner.client.signOut(),staff.client.signOut()]);}};
}
async function message(page,text){await page.waitForFunction(value=>document.getElementById('salesStatus').textContent.includes(value),text);}
async function idle(page){await page.waitForFunction(()=>!document.getElementById('reloadOrders').disabled);}
async function reload(page){await page.locator('#reloadOrders').click();await message(page,'Đã tải dữ liệu mới nhất.');await idle(page);}
async function save(page){
 const response=page.waitForResponse(r=>r.url().endsWith('/rpc/rpc_save_order')&&r.request().method()==='POST');
 await page.locator('#saveOrder').click();const result=await response;assert.equal(result.status(),200,'Save order HTTP status');const receipt=await result.json();await message(page,'Đã lưu đơn');await idle(page);return receipt;
}
async function open(page,id){
 const row=page.locator('#openOrders li').filter({hasText:id.slice(0,8)});await row.locator('button').click();await message(page,'Đã mở dữ liệu đơn từ server.');await idle(page);
}

test('two real browser devices protect revisions, recover an offline cash sale and reconcile one shift',{timeout:120000},async()=>{
 const f=await fixture(),{a,b,staff,owner,workspace,rpc,contextA}=f;
 try{
  await Promise.all([f.login(a),f.login(b)]);await a.waitForFunction(()=>navigator.serviceWorker.controller);
  for(const page of [a,b]){
   assert.equal(await page.locator('#catalogAdmin').isVisible(),false);assert.equal(await page.locator('#staffAdminArea').isVisible(),false);
   assert.equal(await page.locator('#refundArea').isVisible(),false);
  }
  await a.locator('#openingCash').fill('100000');await a.locator('#openShiftForm button').click();await message(a,'Đã mở ca.');
  await reload(b);assert.match(await b.locator('#shiftSummary').textContent(),/100\.000/);
  await a.locator('#addItem').click();let lostSave=false;let originalBody;
  await a.route('**/rpc/rpc_save_order',async route=>{
   if(route.request().method()!=='POST'||lostSave)return route.continue();
   lostSave=true;originalBody=route.request().postDataJSON();const response=await route.fetch();assert.equal(response.status(),200);
   await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Committed save response lost'})});
  });
  await a.locator('#saveOrder').click();await message(a,'Chưa xác nhận');
  assert.equal((await staff.client.request('/rest/v1/orders?select=id&store_id=eq.'+workspace.store_id)).length,1);
  await a.reload();await f.login(a);await a.locator('#saveRecoveryArea').waitFor({state:'visible'});
  const recovered=a.waitForResponse(r=>r.url().endsWith('/rpc/rpc_save_order')&&r.request().method()==='POST');
  await a.locator('#retryOrderSave').click();const recoveredResponse=await recovered;assert.equal(recoveredResponse.status(),200);
  assert.deepEqual(recoveredResponse.request().postDataJSON(),originalBody);const original=await recoveredResponse.json();await message(a,'Đã lưu đơn');await idle(a);
  assert.equal(Number(original.total_amount),35000);assert.equal(original.replayed,true);
  assert.equal((await staff.client.request('/rest/v1/orders?select=id&store_id=eq.'+workspace.store_id)).length,1,'Reload recovery must not create another online order');
  await reload(b);await open(b,original.order_id);
  await a.locator('#addItem').click();const updated=await save(a);assert.equal(updated.order_id,original.order_id);assert.equal(Number(updated.total_amount),70000);
  await b.locator('#customerName').fill('Thay đổi từ bản cũ');await b.locator('#saveOrder').click();await message(b,'máy khác cập nhật');
  const stored=await staff.client.request('/rest/v1/orders?select=id,revision,total_amount,customer&id=eq.'+original.order_id);
  assert.equal(stored[0].revision,updated.revision);assert.equal(Number(stored[0].total_amount),70000);assert.notEqual(stored[0].customer.name,'Thay đổi từ bản cũ');
  await reload(b);await open(b,original.order_id);assert.match(await b.locator('#cartTotal').textContent(),/70\.000/);
  await b.locator('#receivedAmount').fill('100000');await b.locator('#paymentForm button').click();await message(b,'Đơn đã hoàn tất.');
  const onlinePayments=await staff.client.request('/rest/v1/payments?select=id,amount&order_id=eq.'+original.order_id);assert.equal(onlinePayments.length,1);assert.equal(Number(onlinePayments[0].amount),70000);
  // Device A still has its old order snapshot; finalized data cannot be collected twice.
  await a.locator('#receivedAmount').fill('100000');await a.locator('#paymentForm button').click();await message(a,'Đơn đã hoàn tất. Không thể thu tiền');
  assert.equal((await staff.client.request('/rest/v1/payments?select=id&order_id=eq.'+original.order_id)).length,1);
  await a.locator('#newOrder').click();await a.locator('#addItem').click();await contextA.setOffline(true);
  await a.locator('#offlineReceived').fill('50000');await a.locator('#offlineCashForm input[type=checkbox]').check();await a.locator('#offlineCashForm button').click();await message(a,'Đã lưu tại máy việc nhận tiền mặt');
  const records=await a.evaluate(async({url,userId,organizationId,storeId})=>{
   const {OfflineStore}=await import('/assets/offline-store.mjs');return new OfflineStore({url,userId,organizationId,storeId}).list();
  },{url:f.url,userId:staff.client.userId,organizationId:workspace.organization_id,storeId:workspace.store_id});
  assert.equal(records.length,1);assert.equal(records[0].status,'PENDING');assert.equal(records[0].payload.p_expected_total,35000);
  await a.locator('#countedCash').fill('170000');await a.locator('#closeShiftForm button').click();await message(a,'Còn đơn thu tiền tại máy chưa đồng bộ');
  // Persist through a real offline reload, then sign in again when back online.
  await a.reload();await a.locator('#loginPanel').waitFor({state:'visible'});await contextA.setOffline(false);await f.login(a);
  await a.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('1 đơn'));
  // Commit the sync but drop its response to exercise durable idempotent retry.
  let dropped=false;
  await a.route('**/rpc/rpc_sync_offline_sale',async route=>{
   if(route.request().method()!=='POST'||dropped)return route.continue();
   dropped=true;const response=await route.fetch();assert.equal(response.status(),200,'Offline sync committed before dropping response');await route.abort('failed');
  });
  await a.locator('#syncOutbox').click();await message(a,'Hàng đợi vẫn giữ trên máy.');assert.equal(dropped,true);
  assert.equal((await staff.client.request('/rest/v1/payments?select=id&store_id=eq.'+workspace.store_id)).length,2,'Lost response follows a real committed payment');
  await a.locator('#syncOutbox').click();await a.waitForFunction(()=>document.getElementById('outboxSummary').textContent.startsWith('0 đơn'));
  const receipt=await rpc(staff.client,'rpc_sync_offline_sale',{...records[0].payload,p_operation_id:records[0].operationId});
  assert.equal(receipt.replayed,true);assert.equal(receipt.status,'PAID');
  const offlinePayments=await staff.client.request('/rest/v1/payments?select=id,amount&order_id=eq.'+receipt.order_id);assert.equal(offlinePayments.length,1);assert.equal(Number(offlinePayments[0].amount),35000);
  await a.locator('#syncOutbox').click();await message(a,'Đã đồng bộ toàn bộ hàng đợi.');
  assert.equal((await staff.client.request('/rest/v1/payments?select=id&store_id=eq.'+workspace.store_id)).length,2);
  await reload(b);await b.locator('#countedCash').fill('205000');await b.locator('#closeShiftForm button').click();await message(b,'Đã chốt ca');
  const shifts=await staff.client.request('/rest/v1/cash_shifts?select=expected_cash,counted_cash,difference,closed_at&store_id=eq.'+workspace.store_id);
  assert.equal(shifts.length,1);assert.ok(shifts[0].closed_at);assert.equal(Number(shifts[0].expected_cash),205000);assert.equal(Number(shifts[0].difference),0);
  const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}),report=await rpc(owner.client,'rpc_daily_report',{p_date:day});
  assert.equal(Number(report.gross),105000);assert.equal(Number(report.refunds),0);assert.equal(Number(report.paid_orders),2);
  await b.locator('#orderHistoryArea > summary').click();await b.locator('#historyFilter').selectOption('PAID');await b.locator('#orderHistoryForm button').click();
  await b.waitForFunction(()=>document.getElementById('historyStatus').textContent.startsWith('Trang 1'));
  assert.equal(await b.locator('#historyOrders li').count(),2);
  await b.locator('#historySearch').fill(original.order_id);await b.locator('#orderHistoryForm button').click();
  await b.waitForFunction(()=>!document.getElementById('reloadOrders').disabled);assert.equal(await b.locator('#historyOrders li').count(),1);
  await b.locator('#historyOrders button').click();await b.waitForFunction(()=>document.getElementById('historyReceipt').textContent.includes('Thu ròng'));
  assert.match(await b.locator('#historyReceipt').textContent(),/Đã thu 70\.000/);assert.match(await b.locator('#historyReceipt').textContent(),/Tiền thừa 30\.000/);
  assert.equal(await b.locator('[data-action=prepare-refund]').count(),0,'Cashier history never exposes refund preparation');
  await a.locator('#logout').click();await a.locator('#loginPanel').waitFor({state:'visible'});await f.login(a,owner);
  await a.locator('#openingCash').fill('100000');await a.locator('#openShiftForm button').click();await message(a,'Đã mở ca.');
  await a.locator('#orderHistoryArea > summary').click();await a.locator('#historySearch').fill(original.order_id);await a.locator('#orderHistoryForm button').click();await idle(a);
  await a.locator('#historyOrders button').click();await a.locator('[data-action=prepare-refund]').click();await message(a,'Đã chọn giao dịch từ lịch sử');
  assert.equal(await a.locator('#refundPayment').inputValue(),onlinePayments[0].id);assert.match(await a.locator('#refundTargetSummary').textContent(),/70\.000/);
  await a.locator('#refundReason').fill('Pilot owner full refund');await a.locator('#refundConfirmed').check();
  let lostRefund=false;
  await a.route('**/rpc/rpc_refund_payment',async route=>{if(route.request().method()!=='POST'||lostRefund)return route.continue();lostRefund=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
  await a.locator('#refundForm button').click();await message(a,'Chưa xác nhận');
  assert.equal((await owner.client.request('/rest/v1/refunds?select=id&payment_id=eq.'+onlinePayments[0].id)).length,1);
  await a.locator('#refundForm button').click();await message(a,'Đã ghi nhận hoàn toàn bộ');assert.equal(await a.locator('[data-action=prepare-refund]').count(),0);
  const returned=await owner.client.request('/rest/v1/refunds?select=id,amount,method&payment_id=eq.'+onlinePayments[0].id);assert.equal(returned.length,1);assert.equal(Number(returned[0].amount),70000);assert.equal(returned[0].method,'CASH');
  await a.locator('#countedCash').fill('30000');await a.locator('#closeShiftForm button').click();await message(a,'Đã chốt ca');
  const ownerShifts=await owner.client.request('/rest/v1/cash_shifts?select=id,expected_cash,difference&store_id=eq.'+workspace.store_id+'&opened_by=eq.'+owner.client.userId);assert.equal(ownerShifts.length,1);assert.equal(Number(ownerShifts[0].expected_cash),30000);assert.equal(Number(ownerShifts[0].difference),0);
  const afterRefund=await rpc(owner.client,'rpc_daily_report',{p_date:day});assert.equal(Number(afterRefund.gross),105000);assert.equal(Number(afterRefund.refunds),70000);
  await b.locator('#shiftHistoryArea > summary').click();await b.locator('#shiftHistoryFilter').selectOption('CLOSED');await b.locator('#shiftHistoryForm button').click();await idle(b);
  assert.match(await b.locator('#shiftHistoryStatus').textContent(),/Chỉ ca của tôi/);assert.equal(await b.locator('#shiftHistoryList li').count(),1);
  assert.equal((await b.locator('#shiftHistoryList').textContent()).includes(ownerShifts[0].id),false);
  await b.locator('#shiftHistoryList button').click();await idle(b);assert.match(await b.locator('#shiftDetailSummary').textContent(),/Tiền mặt dự kiến: 205\.000/);assert.match(await b.locator('#shiftDetailSummary').textContent(),/Hoàn tiền mặt: 0/);assert.equal(await b.locator('#shiftEventList li').count(),2);
  await a.locator('#shiftHistoryArea > summary').click();await a.locator('#shiftHistoryFilter').selectOption('CLOSED');await a.locator('#shiftHistoryForm button').click();await idle(a);
  assert.match(await a.locator('#shiftHistoryStatus').textContent(),/Toàn cửa hàng/);assert.equal(await a.locator('#shiftHistoryList li').count(),2);
  await a.locator('#shiftHistoryList li').filter({hasText:ownerShifts[0].id}).locator('button').click();await idle(a);
  assert.match(await a.locator('#shiftDetailSummary').textContent(),/Hoàn tiền mặt: 70\.000/);assert.match(await a.locator('#shiftDetailSummary').textContent(),/Tiền mặt dự kiến: 30\.000/);assert.equal(await a.locator('#shiftEventList li').count(),1);assert.match(await a.locator('#shiftEventList').textContent(),/Pilot owner full refund/);
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
