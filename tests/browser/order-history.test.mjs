import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

test('history filters, pagination and receipt are read-only, safe text and cleared on logout',{timeout:60000},async()=>{
 const state={queries:[],receipts:[],status:'REFUNDED'},root=path.resolve('public');
 const row={id:'order-original',order_status:'REFUNDED',channel:'TAKEAWAY',total_amount:80000,created_at:'2026-10-20T02:00:00Z',customer:{name:'<img src=x onerror=alert(1)>',phone:'0900123456'},refund_id:'refund'};
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(pathname.startsWith('/backend/')){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
   if(pathname.includes('/token'))return json({access_token:'token',user:{id:'cashier',email:'staff@example.test'}});
   if(pathname.endsWith('/logout'))return json({});
   if(pathname.endsWith('/organizations'))return json([{id:'org',name:'Cafe'}]);
   if(pathname.endsWith('/stores'))return json([{id:'store',organization_id:'org',name:'Cafe',code:'MAIN',timezone:'Asia/Ho_Chi_Minh'}]);
   if(pathname.endsWith('/rpc_store_context'))return json({can_sell:true});
   if(pathname.endsWith('/products'))return json([{id:'coffee',name:'Cà phê mới',category:'Nước',active:true}]);
   if(pathname.endsWith('/product_variants'))return json([{id:'variant',product_id:'coffee',name:'M',price:99000,active:true}]);
   if(pathname.endsWith('/rpc_order_history')){
    state.queries.push(body);
    if(body.p_from==='2026-01-01')return json({message:'INVALID_HISTORY_FILTER'},400);
    return json({orders:[{...row,id:body.p_before_id?'order-older':row.id}],from_date:'2026-10-20',to_date:'2026-10-20',timezone:'Asia/Ho_Chi_Minh',next_cursor:body.p_before_id?null:{time:row.created_at,id:row.id}});
   }
   if(pathname.endsWith('/rpc_order_receipt')){
    state.receipts.push(body);return json({order:row,items:[{product_name:'Cà phê gốc',variant_name:'M',quantity:2,unit_amount:40000,line_amount:80000,modifier_snapshot:[{name:'Sữa'}]}],payment:{id:'payment',method:'CASH',amount:80000,received_amount:100000,change_amount:20000,created_at:row.created_at},refund:{amount:80000,reason:'Khách đổi ý <script>bad()</script>',created_at:row.created_at},timezone:'Asia/Ho_Chi_Minh'});
   }
   return json([]);
  }
  if(pathname==='/app-config.js'){res.setHeader('Content-Type','application/javascript');res.end('window.MODULAR_POS_CONFIG='+JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/backend',key:'public'}));return;}
  const file=path.resolve(root,'.'+(pathname==='/pos'?'/account.html':pathname));
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{const data=await readFile(file);res.setHeader('Content-Type',/\.(mjs|js)$/.test(file)?'application/javascript':'text/html');res.end(data);}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/pos');await page.locator('#email').fill('staff@example.test');await page.locator('#password').fill('password-long');await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#orderHistoryArea').waitFor({state:'visible'});await page.locator('#addItem').click();
  const cart=await page.locator('#cartItems').textContent();
  await page.locator('#orderHistoryArea > summary').click();await page.locator('#historySearch').fill('Khách');await page.locator('#historyFilter').selectOption('REFUNDED');await page.locator('#orderHistoryForm button').click();
  await page.waitForFunction(()=>document.getElementById('historyStatus').textContent.startsWith('Trang 1'));
  assert.equal(state.queries[0].p_status,'REFUNDED');assert.equal(state.queries[0].p_search,'Khách');assert.equal(state.queries[0].p_org_id,'org');
  await page.locator('#historyOrders button').click();await page.waitForFunction(()=>document.getElementById('historyReceipt').textContent.includes('Thu ròng'));
  const text=await page.locator('#historyReceipt').textContent();assert.match(text,/Cà phê gốc \/ M \+ Sữa × 2/);assert.match(text,/Tiền thừa 20\.000/);assert.match(text,/Thu ròng của đơn: 0/);
  assert.equal(await page.locator('#historyReceipt img, #historyReceipt script, #historyOrders img').count(),0);
  assert.equal(await page.locator('#cartItems').textContent(),cart,'Reading history preserves the working cart');
  await page.locator('#nextHistory').click();await page.waitForFunction(()=>document.getElementById('historyStatus').textContent.startsWith('Trang 2'));
  assert.equal(state.queries[1].p_before_id,row.id);assert.equal(state.queries[1].p_from,'2026-10-20');assert.equal(await page.locator('#historyReceipt').textContent(),'');
  await page.locator('#previousHistory').click();await page.waitForFunction(()=>document.getElementById('historyStatus').textContent.startsWith('Trang 1'));
  await page.locator('#historySearch').fill('0900');await page.locator('#nextHistory').click();await page.waitForFunction(()=>document.getElementById('historyStatus').textContent.startsWith('Trang 1'));
  await page.waitForFunction(()=>!document.getElementById('nextHistory').disabled);assert.equal(state.queries.at(-1).p_before_id,null,'Changing filters resets cursor');
  await page.locator('#historyFrom').fill('2026-01-01');await page.locator('#orderHistoryForm button').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('93 ngày'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});assert.equal(await page.locator('#historyOrders').textContent(),'');assert.equal(await page.locator('#historyReceipt').textContent(),'');assert.equal(await page.locator('#historySearch').inputValue(),'');
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
