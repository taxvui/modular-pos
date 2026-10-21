import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

test('table transfer retries exact request after lost response, protects cart and handles occupied tables',{timeout:60000},async()=>{
 const root=path.resolve('public'),state={requests:[],order:{id:'order-original',channel:'DINE_IN',position_id:'a',order_status:'OPEN',total_amount:70000,revision:1,customer:{},created_at:'2026-10-21T02:00:00Z'}};
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname,json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(pathname.startsWith('/backend/')){
   let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
   if(pathname.includes('/token'))return json({access_token:'token',user:{id:'staff',email:'staff@test.example'}});
   if(pathname.endsWith('/logout'))return json({});
   if(pathname.endsWith('/organizations'))return json([{id:'org',name:'Cafe'}]);
   if(pathname.endsWith('/stores'))return json([{id:'store',organization_id:'org',name:'Cafe',code:'MAIN',timezone:'Asia/Ho_Chi_Minh'}]);
   if(pathname.endsWith('/rpc_store_context'))return json({can_sell:true});
   if(pathname.endsWith('/products'))return json([{id:'coffee',name:'Coffee',category:'Drink',active:true}]);
   if(pathname.endsWith('/product_variants'))return json([{id:'variant',product_id:'coffee',name:'M',price:99000,active:true}]);
   if(pathname.endsWith('/service_positions'))return json([{id:'a',name:'A'},{id:'b',name:'<img src=x onerror=alert(1)>'}]);
   if(pathname.endsWith('/orders'))return json([state.order]);
   if(pathname.endsWith('/order_items'))return json([{variant_id:'variant',product_name:'Coffee',variant_name:'M',quantity:2,unit_amount:35000,modifier_snapshot:[]}]);
   if(pathname.endsWith('/rpc_transfer_order')){
    state.requests.push(body);
    if(state.requests.length>2)return json({message:'POSITION_OCCUPIED'},400);
    state.order={...state.order,position_id:'b',revision:2};
    if(state.requests.length===1)return json({message:'Lost committed response'},503);
    return json({order_id:state.order.id,position_id:'b',revision:2,total_amount:70000,status:'OPEN',operation_id:body.p_operation_id,replayed:true});
   }
   return json([]);
  }
  if(pathname==='/app-config.js'){res.setHeader('Content-Type','application/javascript');res.end('window.MODULAR_POS_CONFIG='+JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/backend',key:'public'}));return;}
  const file=path.resolve(root,'.'+(pathname==='/pos'?'/account.html':pathname));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{res.setHeader('Content-Type',/\.(mjs|js)$/.test(file)?'application/javascript':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/pos');await page.locator('#email').fill('staff@test.example');await page.locator('#password').fill('long-password');await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#salesPanel').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('reloadOrders').disabled);
  assert.equal(await page.locator('#transferOrderForm').isVisible(),false);
  await page.locator('#openOrders button').click();await page.locator('#transferOrderForm').waitFor({state:'visible'});const cart=await page.locator('#cartItems').textContent();
  await page.locator('#transferPosition').selectOption('b');await page.locator('#transferReason').fill('Guest requested another table');await page.locator('#transferOrder').click();
  await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Chưa xác nhận'));
  assert.equal(await page.locator('#transferPosition').isDisabled(),true);assert.equal(await page.locator('#customerName').isDisabled(),true);assert.equal(await page.locator('#addItem').isDisabled(),true);assert.equal(await page.locator('#newOrder').isDisabled(),true);
  await page.locator('#transferOrder').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Đã chuyển bàn'));
  assert.deepEqual(state.requests[0],state.requests[1]);assert.equal(await page.locator('#cartItems').textContent(),cart);assert.equal(await page.locator('#positionChoice').inputValue(),'b');assert.match(await page.locator('#cartTotal').textContent(),/70\.000/);assert.match(await page.locator('#orderTitle').textContent(),/phiên bản 2/);
  assert.equal(await page.locator('#transferOrderForm img').count(),0);
  await page.locator('#transferPosition').selectOption('a');await page.locator('#transferReason').fill('Try occupied table');await page.locator('#transferOrder').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Bàn đích đã có đơn'));
  assert.equal(await page.locator('#transferPosition').isDisabled(),false);assert.equal(await page.locator('#positionChoice').inputValue(),'b');assert.equal(await page.locator('#cartItems').textContent(),cart);
  await page.locator('#customerName').fill('Unsaved guest');assert.equal(await page.locator('#transferOrderForm').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});assert.equal(await page.locator('#transferOrderSummary').textContent(),'');assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
