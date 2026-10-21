import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

async function fixture(){
 const state={canRefund:true,hasShift:true,refunded:false,calls:[]},root=path.resolve('public');
 const order={id:'old-order',order_status:'PAID',channel:'TAKEAWAY',customer:{name:'Khách cũ <img src=x>'},total_amount:80000,created_at:'2026-10-20T02:00:00Z'};
 const payment={id:'old-payment',order_id:order.id,method:'CASH',amount:80000,received_amount:100000,change_amount:20000,created_at:order.created_at};
 const recent=Array.from({length:100},(_,i)=>({id:'recent-'+i,order_id:'recent-order-'+i,method:'CASH',amount:1000}));
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname,json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(pathname.startsWith('/backend/')){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
   if(pathname.includes('/token'))return json({access_token:'token',user:{id:'user',email:'owner@example.test'}});
   if(pathname.endsWith('/logout'))return json({});
   if(pathname.endsWith('/organizations'))return json([{id:'org',name:'Cafe'}]);
   if(pathname.endsWith('/stores'))return json([{id:'store',organization_id:'org',name:'Cafe',code:'MAIN',timezone:'Asia/Ho_Chi_Minh'}]);
   if(pathname.endsWith('/rpc_store_context'))return json({can_sell:true,can_manage_shift:true,can_collect:true,can_refund:state.canRefund});
   if(pathname.endsWith('/products'))return json([{id:'coffee',name:'Cà phê',active:true}]);
   if(pathname.endsWith('/product_variants'))return json([{id:'variant',product_id:'coffee',name:'M',price:35000,active:true}]);
   if(pathname.endsWith('/cash_shifts'))return json(state.hasShift?[{id:'shift',opened_by:'user',opening_amount:200000,closed_at:null}]:[]);
   if(pathname.endsWith('/payments'))return json(recent);
   if(pathname.endsWith('/refunds'))return json(state.refunded?[{payment_id:payment.id}]:[]);
   if(pathname.endsWith('/rpc_order_history'))return json({orders:[{...order,order_status:state.refunded?'REFUNDED':'PAID',refund_id:state.refunded?'refund':null}],from_date:'2026-10-20',to_date:'2026-10-20',timezone:'Asia/Ho_Chi_Minh',next_cursor:null});
   if(pathname.endsWith('/rpc_order_receipt'))return json({order:{...order,order_status:state.refunded?'REFUNDED':'PAID'},items:[],payment,refund:state.refunded?{id:'refund',amount:80000,reason:'Đã hoàn tại quầy',created_at:order.created_at}:null,timezone:'Asia/Ho_Chi_Minh'});
   if(pathname.endsWith('/rpc_refund_payment')){
    state.calls.push(body);if(!state.canRefund)return json({message:'PERMISSION_DENIED'},403);
    if(!state.hasShift)return json({message:'OPEN_SHIFT_REQUIRED'},400);
    assert.equal(body.p_payment_id,payment.id);if(state.refunded)assert.equal(body.p_operation_id,state.calls[0].p_operation_id);
    state.refunded=true;return json({id:'refund',payment_id:payment.id,amount:80000,method:'CASH'});
   }
   return json([]);
  }
  if(pathname==='/app-config.js'){res.setHeader('Content-Type','application/javascript');res.end('window.MODULAR_POS_CONFIG='+JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/backend',key:'public'}));return;}
  const file=path.resolve(root,'.'+(pathname==='/pos'?'/account.html':pathname));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{const data=await readFile(file);res.setHeader('Content-Type',/\.(mjs|js)$/.test(file)?'application/javascript':'text/html');res.end(data);}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch();}catch(e){await new Promise(r=>server.close(r));throw e;}
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const start=async()=>{await page.goto('http://127.0.0.1:'+server.address().port+'/pos');await page.locator('#email').fill('owner@example.test');await page.locator('#password').fill('long-password');await page.locator('#loginForm button[type=submit]').click();await page.locator('#orderHistoryArea').waitFor({state:'visible'});if(!await page.locator('#orderHistoryArea').evaluate(node=>node.open))await page.locator('#orderHistoryArea > summary').click();await page.locator('#orderHistoryForm button').click();await page.locator('#historyOrders button').click();await page.waitForFunction(()=>document.getElementById('historyReceipt').textContent.includes('Thu ròng'));};
 return {page,state,errors,start,close:async()=>{await browser.close();await new Promise(r=>server.close(r));}};
}
const prepare=page=>page.locator('[data-action=prepare-refund]');
test('old history payment can be selected outside the latest 100; confirmations reset and a lost response retries the same operation',{timeout:60000},async()=>{
 const f=await fixture(),{page,state}=f;
 try{
  await f.start();assert.equal(await page.locator('#refundPayment option').count(),101);assert.equal(await page.locator('#refundPayment option[value=old-payment]').count(),0);
  await prepare(page).click();await page.waitForFunction(()=>document.getElementById('refundPayment').value==='old-payment');
  assert.match(await page.locator('#refundTargetSummary').textContent(),/old-order.*old-payment.*80\.000.*Tiền mặt/);assert.equal(await page.locator('#refundTargetSummary img').count(),0);
  await page.locator('#refundReason').fill('Khách yêu cầu hoàn đủ');await page.locator('#refundConfirmed').check();
  await page.locator('#refundPayment').selectOption('recent-1');assert.equal(await page.locator('#refundConfirmed').isChecked(),false);assert.equal(await page.locator('#refundReason').inputValue(),'');
  await prepare(page).click();await page.waitForFunction(()=>document.getElementById('refundPayment').value==='old-payment');
  await page.locator('#refundReason').fill('Khách yêu cầu hoàn đủ');await page.locator('#refundForm button').click();assert.equal(state.calls.length,0,'Actual refund confirmation remains mandatory');
  await page.locator('#refundConfirmed').check();await page.route('**/rpc/rpc_refund_payment',async route=>{await route.fetch();await route.abort('failed');},{times:1});
  await page.locator('#refundForm button').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Chưa xác nhận'));
  await page.locator('#refundForm button').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Đã ghi nhận hoàn toàn bộ'));
  assert.equal(state.calls.length,2);assert.deepEqual(state.calls[0],state.calls[1]);assert.equal(await page.locator('#refundPayment option[value=old-payment]').count(),0);assert.equal(await prepare(page).count(),0);assert.equal(await page.locator('#refundConfirmed').isChecked(),false);
  assert.match(await page.locator('#historyReceipt').textContent(),/Đã hoàn 80\.000/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('a payment refunded elsewhere is rechecked before selection',{timeout:60000},async()=>{
 const f=await fixture(),{page,state}=f;
 try{await f.start();state.refunded=true;await prepare(page).click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('đã được hoàn'));assert.equal(await prepare(page).count(),0);assert.equal(state.calls.length,0);assert.equal(await page.locator('#refundPayment').inputValue(),'');assert.deepEqual(f.errors,[]);}finally{await f.close();}
});
test('cashiers cannot prepare refunds; revoked permission and a missing own shift are rejected',{timeout:60000},async()=>{
 const f=await fixture(),{page,state}=f;
 try{
  state.canRefund=false;await f.start();assert.equal(await prepare(page).count(),0);assert.equal(await page.locator('#refundArea').isVisible(),false);
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});state.canRefund=true;state.hasShift=false;await f.start();await prepare(page).click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('mở ca'));assert.equal(state.calls.length,0);
  state.hasShift=true;state.canRefund=false;await prepare(page).click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('chưa được cấp quyền'));assert.equal(state.calls.length,0);assert.equal(await page.locator('#refundArea').isVisible(),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
