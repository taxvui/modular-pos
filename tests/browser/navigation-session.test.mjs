import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

test('login survives home navigation and reload; logout survives reload', {timeout:90000}, async()=>{
 const root=path.resolve('public');
 const config=JSON.parse(await readFile('vercel.json','utf8'));
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  const redirect=config.redirects.find(r=>r.source===pathname);
  if(redirect){res.writeHead(307,{Location:redirect.destination}).end();return;}
  const file=path.resolve(root,'.'+(pathname==='/account'?'/account.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.mjs')||file.endsWith('.js')?'application/javascript':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({serviceWorkers:'block'});
  let signins=0,refreshes=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/app-config.js',r=>r.fulfill({contentType:'application/javascript',body:"window.MODULAR_POS_CONFIG={url:'https://test.supabase.co',key:'public-key'};"}));
  await page.route('https://test.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
   if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
   let data=[];
   if(url.pathname.endsWith('/token')){
    if(url.searchParams.get('grant_type')==='password')signins++;
    else{refreshes++;assert.equal(req.postDataJSON().refresh_token,`refresh-${refreshes-1}`);}
    data={access_token:'access',refresh_token:`refresh-${refreshes}`,expires_in:3600,user:{id:'owner',email:'owner@example.test'}};
   }
   await route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
  });
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.goto(origin+'/');assert.equal(new URL(page.url()).pathname,'/account');
  await page.locator('#email').fill('owner@example.test');await page.locator('#password').fill('test-password');
  await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#bootstrapPanel').waitFor({state:'visible'});
  await page.getByRole('link',{name:'Modular POS',exact:true}).click();
  await page.locator('#bootstrapPanel').waitFor({state:'visible'});
  assert.equal(await page.locator('#identity').textContent(),'owner@example.test');
  assert.equal(await page.locator('#loginPanel').isVisible(),false);
  await page.reload();await page.locator('#bootstrapPanel').waitFor({state:'visible'});
  assert.equal(signins,1);assert.equal(refreshes,2);
  await page.locator('#logout').click();await page.locator('#loginPanel').waitFor({state:'visible'});
  await page.reload();await page.getByText('Sẵn sàng đăng nhập.',{exact:true}).waitFor();
  assert.equal(await page.locator('#workspacePanel').isVisible(),false);
  assert.equal(refreshes,2);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
