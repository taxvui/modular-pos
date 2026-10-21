import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

test('order timeline safely pages events, preserves cart and discards late logout responses',{timeout:60000},async()=>{
 const state={queries:[],receipts:[],events:[],mode:'ok'},root=path.resolve('public');
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
   if(pathname.endsWith('/rpc_order_events')){
    state.events.push(body);
    const base={created_at:row.created_at,actor_id:'cashier',full_name:'<img src=x onerror=alert(1)>'};
    const events=body.p_before_id?[{...base,id:'old',action:'pos.payment.collected',details:{method:'CASH',amount:80000,received_amount:100000,change_amount:20000,payment_id:'payment',shift_id:'cashier-shift'}}]:[
     {...base,id:'refund-event',action:'pos.payment.refunded',reason:'Guest <script>bad()</script>',details:{method:'CASH',amount:80000,payment_id:'payment',refund_id:'refund',shift_id:'owner-shift'}},
     {...base,id:'transfer-event',action:'pos.order.transferred',reason:'Guest moved',details:{revision:3,total_amount:80000,from_position_id:'a',to_position_id:'b',from_position_name:'A',to_position_name:'<img src=x>'}}
    ];
    const data={order_id:state.mode==='bad'?'wrong-order':body.p_order_id,events,timezone:'Asia/Ho_Chi_Minh',read_at:row.created_at,next_cursor:body.p_before_id?null:{time:row.created_at,id:'transfer-event'}};
    if(state.mode==='hold'){state.release=()=>json(data);state.started();return;}
    return json(data);
   }
   if(pathname.endsWith('/rpc_order_history')){
    state.queries.push(body);
    if(body.p_from==='2026-01-01')return json({message:'INVALID_HISTORY_FILTER'},400);
    return json({orders:[{...row,id:body.p_before_id?'order-older':row.id}],from_date:'2026-10-20',to_date:'2026-10-20',timezone:'Asia/Ho_Chi_Minh',next_cursor:body.p_before_id?null:{time:row.created_at,id:row.id}});
   }
   if(pathname.endsWith('/rpc_order_receipt')){
    state.receipts.push(body);return json({order:{...row,id:body.p_order_id},items:[{product_name:'Cà phê gốc',variant_name:'M',quantity:2,unit_amount:40000,line_amount:80000,modifier_snapshot:[{name:'Sữa'}]}],payment:{id:'payment',method:'CASH',amount:80000,received_amount:100000,change_amount:20000,created_at:row.created_at},refund:{amount:80000,reason:'Khách đổi ý <script>bad()</script>',created_at:row.created_at},timezone:'Asia/Ho_Chi_Minh'});
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
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/pos');await page.locator('#email').fill('staff@example.test');await page.locator('#password').fill('password-long');await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#orderHistoryArea').waitFor({state:'visible'});await page.locator('#addItem').click();const cart=await page.locator('#cartItems').textContent();
  await page.locator('#orderHistoryArea > summary').click();await page.locator('#orderHistoryForm button').click();await page.locator('#historyOrders button').click();
  await page.locator('#historyReceipt details > summary').click();assert.equal(state.events.length,0,'Timeline loads only when requested');
  await page.locator('[data-action=load-order-events]').click();await page.waitForFunction(()=>document.querySelector('[data-role=order-events-status]').textContent.includes('Trang 1'));
  assert.equal(state.events[0].p_order_id,'order-original');assert.equal(state.events[0].p_org_id,'org');
  const timeline=page.locator('[data-role=order-events-list]');assert.match(await timeline.textContent(),/Hoàn tiền/);assert.match(await timeline.textContent(),/Chuyển bàn/);assert.match(await timeline.textContent(),/Guest <script>bad/);assert.match(await timeline.textContent(),/Ca thực hiện owner-shift/);assert.equal(await timeline.locator('img,script').count(),0);
  await page.locator('[data-action=next-order-events]').click();await page.waitForFunction(()=>document.querySelector('[data-role=order-events-status]').textContent.includes('Trang 2'));
  assert.equal(state.events.at(-1).p_before_id,'transfer-event');assert.match(await timeline.textContent(),/Tiền thừa 20\.000/);assert.match(await timeline.textContent(),/Thu tiền/);
  await page.locator('[data-action=previous-order-events]').click();await page.waitForFunction(()=>document.querySelector('[data-role=order-events-status]').textContent.includes('Trang 1'));
  assert.equal(state.events.at(-1).p_before_id,null);assert.equal(await page.locator('#cartItems').textContent(),cart);
  state.mode='bad';await page.locator('[data-action=load-order-events]').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Chưa nhận được nhật ký hợp lệ'));
  assert.match(await timeline.textContent(),/Hoàn tiền/,'A mismatched response never replaces the selected order timeline');state.mode='ok';
  await page.locator('#nextHistory').click();await page.waitForFunction(()=>document.getElementById('historyStatus').textContent.startsWith('Trang 2'));assert.equal(await page.locator('[data-role=order-events-list]').count(),0);
  await page.locator('#historyOrders button').click();await page.locator('#historyReceipt details > summary').click();assert.equal(await page.locator('[data-role=order-events-list]').textContent(),'');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  state.mode='hold';const started=new Promise(r=>state.started=r);await page.locator('[data-action=load-order-events]').click();await started;
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});
  const finished=page.waitForEvent('requestfinished',{predicate:r=>r.url().endsWith('/rpc/rpc_order_events')});state.release();await finished;
  assert.equal(await page.locator('#historyReceipt').textContent(),'');assert.equal(await page.locator('[data-role=order-events-list]').count(),0);assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
