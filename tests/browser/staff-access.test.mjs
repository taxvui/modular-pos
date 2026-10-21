import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

async function fixture(){
 const state={user:'owner',joined:false,invites:[],creates:[],changes:[],accepts:[],member:null};
 const root=path.resolve('public');
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(pathname.startsWith('/backend/')){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
   if(pathname.includes('/token'))return json({access_token:'session',user:{id:state.user,email:state.user+'@example.test'}});
   if(pathname.endsWith('/logout'))return json({});
   if(pathname.endsWith('/organizations'))return json(state.user==='owner'||state.joined?[{id:'org',name:'Cafe'}]:[]);
   if(pathname.endsWith('/stores'))return json(state.user==='owner'||state.joined?[{id:'store',organization_id:'org',name:'Cafe',code:'MAIN'}]:[]);
   if(pathname.endsWith('/rpc_store_context'))return json({can_sell:true,can_manage_shift:true,can_collect:true,can_manage_staff:state.user==='owner'});
   if(pathname.endsWith('/products'))return json([{id:'coffee',name:'Cà phê',active:true}]);
   if(pathname.endsWith('/product_variants'))return json([{id:'v',product_id:'coffee',name:'M',price:35000,active:true}]);
   if(pathname.endsWith('/rpc_create_staff_invitation')){
    state.creates.push(body);let row=state.invites.find(r=>r.operation_id===body.p_operation_id);
    if(!row){row={id:'invite-'+state.invites.length,email:body.p_email,role_code:body.p_role,status:'OPEN',expires_at:new Date(Date.now()+86400000).toISOString(),operation_id:body.p_operation_id};state.invites.unshift(row);}
    return json(row);
   }
   if(pathname.endsWith('/rpc_store_staff_snapshot'))return json({members:state.member?[state.member]:[],members_total:state.member?1:0,invitations:state.invites});
   if(pathname.endsWith('/rpc_accept_staff_invitation')){
    state.accepts.push(body);state.joined=true;state.invites[0].status='ACCEPTED';
    state.member={user_id:'staff',email:'staff@example.test',full_name:body.p_full_name,role_code:'CASHIER',active:true,revision:1};
    return json({store_id:'store',status:'ACCEPTED'});
   }
   if(pathname.endsWith('/rpc_set_store_staff')){
    state.changes.push(body);state.member={...state.member,role_code:body.p_role,active:body.p_active,revision:2};return json(state.member);
   }
   if(pathname.endsWith('/rpc_revoke_staff_invitation')){const row=state.invites.find(r=>r.id===body.p_invitation_id);row.status='REVOKED';return json(row);}
   return json([]);
  }
  if(pathname==='/app-config.js'){res.setHeader('Content-Type','application/javascript');res.end(`window.MODULAR_POS_CONFIG=${JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/backend',key:'public'})}`);return;}
  const file=path.resolve(root,'.'+(pathname==='/pos'?'/account.html':pathname));
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{const data=await readFile(file);res.setHeader('Content-Type',/\.(mjs|js)$/.test(file)?'application/javascript':'text/html');res.end(data);}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;try{browser=await chromium.launch();}catch(e){server.close();throw e;}
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
 const login=async()=>{await page.locator('#email').fill(state.user+'@example.test');await page.locator('#password').fill('correct-password');await page.locator('#loginForm button[type=submit]').click();await page.locator('#workspacePanel').waitFor({state:'visible'});};
 const logout=async()=>{await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});};
 return {state,page,login,logout,origin:'http://127.0.0.1:'+server.address().port,close:async()=>{await browser.close();await new Promise(r=>server.close(r));}};
}

test('owner issues recoverable codes; new staff joins; role changes retry and logout clears secrets',{timeout:60000},async()=>{
 const f=await fixture(),{page,state,login,logout}=f;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(f.origin+'/pos');await login();await page.locator('#staffAdminArea').waitFor({state:'visible'});await page.locator('#staffAdminArea > summary').click();
  await page.locator('#staffInviteEmail').fill('staff@example.test');
  await page.route('**/rpc_create_staff_invitation',async route=>{await route.fetch();await route.abort('failed');},{times:1});
  await page.locator('#createStaffInviteForm button').click();
  await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Chưa xác nhận'));
  assert.equal(await page.locator('#staffInviteCodeArea').isVisible(),false);
  await page.locator('#createStaffInviteForm button').click();await page.locator('#staffInviteCodeArea').waitFor({state:'visible'});
  assert.deepEqual(state.creates[0],state.creates[1],'Retry retains operation and token');
  const token=await page.locator('#staffInviteCode').inputValue();assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(state.invites).includes(token),false,'Metadata contains no secret');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await logout();assert.equal(await page.locator('#staffInviteCode').inputValue(),'');
  state.user='staff';await login();assert.equal(await page.locator('#salesPanel').isVisible(),false);
  await page.locator('#joinStaffName').fill('Thu ngân mới');await page.locator('#joinStaffToken').fill(token);await page.locator('#joinStoreForm button').click();
  await page.locator('#salesPanel').waitFor({state:'visible'});
  assert.deepEqual(state.accepts,[{p_token:token,p_full_name:'Thu ngân mới'}]);assert.equal(await page.locator('#joinStaffToken').inputValue(),'');
  assert.equal(await page.locator('#staffAdminArea').isVisible(),false);
  await logout();state.user='owner';await login();await page.locator('#staffAdminArea').waitFor({state:'visible'});
  if(!await page.locator('#reloadStaff').isVisible())await page.locator('#staffAdminArea > summary').click();
  await page.locator('#reloadStaff').click();await page.locator('#staffMembers summary').click();
  let form=page.locator('#staffMembers form');await form.locator('[name=role]').selectOption('MANAGER');await form.locator('[name=reason]').fill('Phân công quản lý ca');
  await page.route('**/rpc_set_store_staff',async route=>{await route.fetch();await route.abort('failed');},{times:1});
  await form.locator('button').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Chưa xác nhận'));
  await form.locator('button').click();await page.waitForFunction(()=>document.getElementById('salesStatus').textContent.includes('Đã cập nhật quyền'));
  assert.deepEqual(state.changes[0],state.changes[1]);assert.equal(state.changes[1].p_expected_revision,1);
  await page.locator('#staffMembers summary').click();form=page.locator('#staffMembers form');await form.locator('[name=active]').uncheck();await form.locator('[name=reason]').fill('Kết thúc công việc');
  await form.locator('button').click();assert.equal(state.changes.length,2,'Local work confirmation blocks accidental disable');
  await form.locator('input[type=checkbox]').last().check();await form.locator('button').click();await page.waitForFunction(()=>document.getElementById('staffMembers').textContent.includes('Đã ngừng quyền'));
  assert.equal(state.changes[2].p_active,false);
  await page.locator('#staffInviteEmail').fill('other@example.test');await page.locator('#createStaffInviteForm button').click();await page.locator('#staffInviteCodeArea').waitFor({state:'visible'});
  await page.locator('#staffInvitations button').click();await page.locator('#staffInviteCodeArea').waitFor({state:'hidden'});assert.equal(await page.locator('#staffInviteCode').inputValue(),'');
  assert.deepEqual(errors,[]);
 }finally{await f.close();}
});
