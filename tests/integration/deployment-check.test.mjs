import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {checkDeployment} from '../../scripts/check-deployment.mjs';

test('deployment checker validates actual built files, Supabase Auth and anonymous RPC denials',{timeout:90000},async()=>{
 const config=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const url=config.API_URL??config.api_url,key=config.ANON_KEY??config.anon_key;
 assert.ok(url&&key);assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'Disposable local Supabase only');
 execFileSync(process.execPath,['scripts/build-vercel.mjs'],{stdio:'pipe',env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:key}});
 const root=path.resolve('public'),server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname==='/account.html'){res.writeHead(308,{Location:'/account'}).end();return;}
  const file=path.resolve(root,'.'+(pathname==='/account'?'/account.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{const body=await readFile(file);res.setHeader('Content-Type',file.endsWith('.json')?'application/json':/\.(mjs|js)$/.test(file)?'application/javascript':'text/html');res.end(body);}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const site='http://127.0.0.1:'+server.address().port,result=await checkDeployment(site,{allowLocal:true});
  assert.deepEqual(result.checks.filter(c=>!c.ok),[]);assert.equal(result.ok,true);assert.equal(result.checks.filter(c=>c.name.startsWith('anonymous-rpc:')).length,6);assert.equal(result.notVerified.includes('PHYSICAL_DEVICES'),true);
  const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/check-deployment.mjs','--url',site,'--allow-local','--json'],{stdio:['ignore','pipe','pipe']});let text='',errors='';child.stdout.on('data',d=>text+=d);child.stderr.on('data',d=>errors+=d);child.on('error',reject);child.on('close',code=>resolve({code,text,errors}));});
  assert.equal(output.code,0,'CLI failed without exposing credentials');assert.equal(JSON.parse(output.text).ok,true);assert.equal((output.text+output.errors).includes(key),false);
 }finally{await new Promise(r=>server.close(r));}
});
