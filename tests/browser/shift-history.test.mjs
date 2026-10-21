import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

test('shift history reads own cash and bank reconciliation, paginates safely and clears on logout',{timeout:60000},async()=>{
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
   if(pathname.endsWith('/rpc_store_context'))return json({can_sell:true,can_manage_shift:true,can_report:false});
   if(pathname.endsWith('/products'))return json([{id:'coffee',name:'Cà phê mới',category:'Nước',active:true}]);
   if(pathname.endsWith('/product_variants'))return json([{id:'variant',product_id:'coffee',name:'M',price:99000,active:true}]);
   if(pathname.endsWith('/rpc_shift_history')){
    state.queries.push(body);if(body.p_from==='2026-01-01')return json({message:'INVALID_SHIFT_FILTER'},400);
    return json({shifts:[{id:body.p_before_id?'older-shift':'own-shift',full_name:'<img src=x onerror=alert(1)>',opening_amount:100000,opened_at:row.created_at,closed_at:row.created_at,expected_cash:170000,counted_cash:165000,difference:-5000}],scope:'OWN',timezone:'Asia/Ho_Chi_Minh',from_date:'2026-10-20',to_date:'2026-10-20',next_cursor:body.p_before_id?null:{time:row.created_at,id:'own-shift'}});
   }
   if(pathname.endsWith('/rpc_shift_summary'))return json({shift:{id:body.p_shift_id,opening_amount:100000,opened_at:row.created_at,closed_at:row.created_at,expected_cash:170000,counted_cash:165000,difference:-5000},full_name:'Thu ngân',timezone:'Asia/Ho_Chi_Minh',read_at:row.created_at,totals:{cash_sales:70000,cash_refunds:0,transfer_sales:35000,transfer_refunds:0,cash_received:100000,change_given:30000,expected_cash:170000,net_collections:105000,payment_count:2,refund_count:0}});
   if(pathname.endsWith('/rpc_shift_transactions')){
    state.receipts.push(body);return json({shift_id:body.p_shift_id,transactions:[{id:body.p_before_id?'event-older':'event',kind:body.p_before_id?'REFUND':'PAYMENT',amount:70000,method:'CASH',order_id:'order',payment_id:'payment',created_at:row.created_at,full_name:'Thu ngân',received_amount:100000,change_amount:30000,reason:body.p_before_id?'<script>bad()</script>':null}],next_cursor:body.p_before_id?null:{time:row.created_at,kind:'PAYMENT',id:'event'}});
   }
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
  await page.locator('#shiftHistoryArea').waitFor({state:'visible'});assert.equal(await page.locator('#reportArea').isVisible(),false);
  await page.locator('#addItem').click();const cart=await page.locator('#cartItems').textContent();
  await page.locator('#shiftHistoryArea > summary').click();await page.locator('#shiftHistoryForm button').click();
  await page.waitForFunction(()=>document.getElementById('shiftHistoryStatus').textContent.includes('Trang 1'));
  assert.match(await page.locator('#shiftHistoryStatus').textContent(),/Chỉ ca của tôi/);assert.equal(state.queries[0].p_org_id,'org');
  await page.locator('#shiftHistoryList button').click();await page.waitForFunction(()=>document.getElementById('shiftDetailSummary').textContent.includes('Thu ròng'));
  const summary=await page.locator('#shiftDetailSummary').textContent();assert.match(summary,/Thu chuyển khoản: 35\.000/);assert.match(summary,/Tiền mặt dự kiến: 170\.000/);assert.match(summary,/Lệch -5\.000/);assert.match(summary,/Tiền thừa: 30\.000/);
  assert.equal(await page.locator('#cartItems').textContent(),cart);
  await page.locator('#nextShiftEvent').click();await page.waitForFunction(()=>document.getElementById('shiftEventStatus').textContent.includes('Trang 2'));
  assert.equal(state.receipts.at(-1).p_before_kind,'PAYMENT');assert.match(await page.locator('#shiftEventList').textContent(),/<script>bad/);
  assert.equal(await page.locator('#shiftHistoryList img, #shiftEventList script').count(),0);
  await page.locator('#previousShiftEvent').click();await page.waitForFunction(()=>document.getElementById('shiftEventStatus').textContent.includes('Trang 1'));
  await page.locator('#nextShiftPage').click();await page.waitForFunction(()=>document.getElementById('shiftHistoryStatus').textContent.includes('Trang 2'));
  assert.equal(state.queries.at(-1).p_before_id,'own-shift');assert.equal(await page.locator('#shiftDetailSummary').textContent(),'');
  await page.locator('#shiftHistoryFilter').selectOption('CLOSED');await page.locator('#previousShiftPage').click();await page.waitForFunction(()=>document.getElementById('shiftHistoryStatus').textContent.includes('Trang 1'));
  assert.equal(state.queries.at(-1).p_before_id,null);
  await page.locator('#shiftHistoryFrom').fill('2026-01-01');await page.locator('#shiftHistoryForm button').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('93 ngày'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});assert.equal(await page.locator('#shiftHistoryList').textContent(),'');assert.equal(await page.locator('#shiftEventList').textContent(),'');assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
