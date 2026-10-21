import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

async function fixture(canSell=true){
 const root=path.resolve('public'),state={mode:'ok',opens:[],payments:[]};
 const order={id:'old-order',channel:'DINE_IN',position_id:'inactive-table',order_status:'OPEN',total_amount:80000,revision:4,customer:{name:'Current guest <img src=x>'},created_at:'2026-10-01T02:00:00Z'};
 const lines=[{variant_id:'variant',product_name:'Coffee original',variant_name:'M',quantity:2,unit_amount:40000,line_amount:80000,modifier_snapshot:[{id:'milk',name:'Milk',price:5000}]}];
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname,json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(pathname.startsWith('/backend/')){
   let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
   if(pathname.includes('/token'))return json({access_token:'token',user:{id:'cashier',email:'staff@example.test'}});
   if(pathname.endsWith('/logout'))return json({});
   if(pathname.endsWith('/organizations'))return json([{id:'org',name:'Cafe'}]);
   if(pathname.endsWith('/stores'))return json([{id:'store',organization_id:'org',name:'Cafe',code:'MAIN',timezone:'Asia/Ho_Chi_Minh'}]);
   if(pathname.endsWith('/rpc_store_context'))return json({can_sell:canSell,can_report:!canSell,can_collect:canSell,can_manage_shift:canSell});
   if(pathname.endsWith('/products'))return json([{id:'coffee',name:'Coffee current',category:'Drink',active:true}]);
   if(pathname.endsWith('/product_variants'))return json([{id:'variant',product_id:'coffee',name:'M',price:99000,active:true}]);
   if(pathname.endsWith('/service_positions'))return json([{id:'active-table',name:'Active table'}]);
   if(pathname.endsWith('/cash_shifts'))return json([{id:'shift',opened_by:'cashier',closed_at:null,opening_amount:0}]);
   if(pathname.endsWith('/rpc_order_history'))return json({orders:[{...order,revision:1,total_amount:40000}],next_cursor:null,from_date:'2026-10-01',to_date:'2026-10-21',timezone:'Asia/Ho_Chi_Minh'});
   if(pathname.endsWith('/rpc_order_receipt'))return json({order:{...order,revision:1,total_amount:40000},items:lines,payment:null,refund:null,position_name:'Old table',timezone:'Asia/Ho_Chi_Minh'});
   if(pathname.endsWith('/rpc_open_order')){
    state.opens.push(body);if(state.mode==='finalized')return json({message:'ORDER_FINALIZED'},400);
    const data={order:{...order,id:state.mode==='wrong'?'wrong-order':order.id},items:lines,position_name:'Old table <script>text</script>'};
    if(state.mode==='hold'){state.release=()=>json(data);state.started();return;}
    return json(data);
   }
   if(pathname.endsWith('/rpc_collect_payment')){state.payments.push(body);return json({id:'payment',amount:80000,received_amount:100000,change_amount:20000});}
   return json([]);
  }
  if(pathname==='/app-config.js'){res.setHeader('Content-Type','application/javascript');res.end('window.MODULAR_POS_CONFIG='+JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/backend',key:'public'}));return;}
  const file=path.resolve(root,'.'+(pathname==='/pos'?'/account.html':pathname));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{res.setHeader('Content-Type',/\.(mjs|js)$/.test(file)?'application/javascript':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const login=async()=>{await page.goto('http://127.0.0.1:'+server.address().port+'/pos');await page.locator('#email').fill('staff@example.test');await page.locator('#password').fill('long-password');await page.locator('#loginForm button[type=submit]').click();await page.locator('#orderHistoryArea').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('reloadOrders').disabled);};
 const history=async()=>{await page.locator('#orderHistoryArea > summary').click();await page.locator('#orderHistoryForm button').click();await page.locator('#historyOrders button').click();await page.waitForFunction(()=>document.getElementById('historyReceipt').textContent.includes('Tổng đơn'));};
 return {state,page,errors,login,history,close:async()=>{await browser.close();await new Promise(r=>server.close(r));}};
}
const message=(page,text)=>page.waitForFunction(value=>document.getElementById('salesStatus').textContent.includes(value),text);

test('open from history protects unsaved cart and uses fresh server revision, items and prices',{timeout:60000},async()=>{
 const f=await fixture(),{page,state}=f;
 try{
  await f.login();await page.locator('#addItem').click();const cart=await page.locator('#cartItems').textContent();await f.history();
  assert.equal(await page.locator('#openOrders button').count(),0,'Historical order is not in recent orders');
  await page.locator('[data-action=open-history-order]').click();await message(page,'Giỏ có thay đổi chưa lưu');assert.equal(state.opens.length,0);assert.equal(await page.locator('#cartItems').textContent(),cart);
  await page.locator('#newOrder').click();state.mode='wrong';await page.locator('[data-action=open-history-order]').click();await message(page,'Chưa nhận được dữ liệu đơn hợp lệ');assert.equal(await page.locator('#cartItems').textContent(),'');
  state.mode='finalized';await page.locator('[data-action=open-history-order]').click();await message(page,'Đơn đã hoàn tất');assert.equal(await page.locator('#cartItems').textContent(),'');
  state.mode='ok';await page.locator('[data-action=open-history-order]').click();await message(page,'Đã mở đơn từ lịch sử');
  assert.equal(state.opens.at(-1).p_order_id,'old-order');assert.equal(state.opens.at(-1).p_store_id,'store');assert.match(await page.locator('#orderTitle').textContent(),/phiên bản 4/);assert.match(await page.locator('#cartItems').textContent(),/Coffee original \/ M \+ Milk × 2/);assert.match(await page.locator('#cartTotal').textContent(),/80\.000/);assert.equal(await page.locator('#positionChoice').inputValue(),'inactive-table');assert.match(await page.locator('#positionChoice option:checked').textContent(),/Old table <script>text/);assert.equal(await page.locator('#customerName').inputValue(),'Current guest <img src=x>');assert.equal(await page.locator('#sellingArea img,#sellingArea script').count(),0);
  await page.locator('#reloadOrders').click();await message(page,'Đã tải dữ liệu mới nhất');assert.equal(await page.locator('#positionChoice').inputValue(),'inactive-table');
  await page.locator('#customerName').fill('Unsaved change');const calls=state.opens.length;await page.locator('[data-action=open-history-order]').click();await message(page,'Giỏ có thay đổi chưa lưu');assert.equal(state.opens.length,calls);assert.equal(await page.locator('#customerName').inputValue(),'Unsaved change');
  await page.locator('#newOrder').click();await page.locator('[data-action=open-history-order]').click();await message(page,'Đã mở đơn từ lịch sử');
  await page.locator('#receivedAmount').fill('100000');await page.locator('#paymentForm button').click();await message(page,'Đơn đã hoàn tất.');
  assert.equal(state.payments[0].p_order_id,'old-order');assert.equal(state.payments[0].p_expected_revision,4);assert.equal(state.payments[0].p_received_amount,100000);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('reporting-only history does not expose opening for sale',{timeout:60000},async()=>{
 const f=await fixture(false);
 try{await f.login();await f.history();assert.equal(await f.page.locator('[data-action=open-history-order]').count(),0);assert.equal(f.state.opens.length,0);assert.deepEqual(f.errors,[]);}finally{await f.close();}
});

test('late order opening response cannot repopulate the editor after logout',{timeout:60000},async()=>{
 const f=await fixture(),{page,state}=f;
 try{
  await f.login();await f.history();state.mode='hold';const started=new Promise(r=>state.started=r);await page.locator('[data-action=open-history-order]').click();await started;
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});const finished=page.waitForEvent('requestfinished',{predicate:r=>r.url().endsWith('/rpc/rpc_open_order')});state.release();await finished;
  assert.equal(await page.locator('#cartItems').textContent(),'');assert.equal(await page.locator('#customerName').inputValue(),'');assert.equal(await page.locator('#orderTitle').textContent(),'Đơn mới');assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
