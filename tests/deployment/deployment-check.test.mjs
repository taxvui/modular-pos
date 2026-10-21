import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,cp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkDeployment} from '../../scripts/check-deployment.mjs';
import {validatePublicConfig} from '../../scripts/public-config.mjs';
const jwt=role=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
const site='https://pos.example.test',backend='https://project.supabase.test';
function fixture(){
 const buildId='0123456789abcdef0123',files=new Map([
  ['/account.html','<!doctype html><title>POS</title>'],['/assets/account.mjs','export const account=true;'],['/assets/sales.mjs','export const sales=true;'],
  ['/app-config.js','window.MODULAR_POS_CONFIG = '+JSON.stringify({url:backend,key:'sb_publishable_fixture'})+';\n'],
  ['/sw.js',"const CACHE='modular-pos-shell-"+buildId+"';"],['/health.json',JSON.stringify({status:'STATIC_BUILD_READY',databaseChecked:false})]
 ]),calls=[],overrides=new Map();
 const manifest=()=>JSON.stringify({version:1,buildId,assets:[...files].map(([name,body])=>({path:name,sha256:createHash('sha256').update(body).digest('hex')}))});
 const fetcher=async(url,options)=>{
  calls.push({url,options});const u=new URL(url);if(overrides.has(u.href))return overrides.get(u.href)(options);
  if(u.origin===site){
   const body=u.pathname==='/deployment-manifest.json'?manifest():files.get(u.pathname);if(body===undefined)return new Response('Missing',{status:404});
   const type=u.pathname.endsWith('.json')?'application/json':u.pathname.endsWith('.html')?'text/html':'application/javascript';return new Response(body,{headers:{'Content-Type':type}});
  }
  if(u.origin===backend){
   if(u.pathname==='/auth/v1/settings')return Response.json({external:{email:true}});
   if(u.pathname.startsWith('/rest/v1/rpc/'))return Response.json({code:'42501',message:'permission denied'},{status:401});
   if(u.pathname.startsWith('/rest/v1/'))return Response.json([]);
  }
  throw new Error('Unexpected URL');
 };
 return {files,calls,overrides,fetcher,manifest};
}

test('deployment probe checks served assets and only anonymous, read-only APIs',async()=>{
 const f=fixture(),result=await checkDeployment(site,{fetcher:f.fetcher});assert.equal(result.ok,true);assert.equal(result.notVerified.includes('BACKUP_RESTORE'),true);
 const posts=f.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,6);assert.ok(posts.every(c=>/rpc_(store_context|order_history|shift_history|order_receipt|order_events|open_order)$/.test(c.url)));assert.ok(posts.every(c=>!c.options.headers.Authorization));
 assert.ok(posts.every(c=>JSON.parse(c.options.body).p_org_id==='00000000-0000-0000-0000-000000000000'));
 assert.equal(JSON.stringify(result).includes('sb_publishable_fixture'),false);
});

test('deployed configuration rejects private keys before any backend request',async()=>{
 for(const key of ['sb_secret_NEVER_PRINT',jwt('service_role'),jwt('authenticated')]){
  const f=fixture();f.files.set('/app-config.js','window.MODULAR_POS_CONFIG='+JSON.stringify({url:backend,key})+';');const r=await checkDeployment(site,{fetcher:f.fetcher});
  assert.equal(r.ok,false);assert.ok(r.checks.some(c=>c.name==='public-config'&&!c.ok));assert.equal(f.calls.some(c=>c.url.startsWith(backend)),false);assert.equal(JSON.stringify(r).includes(key),false);
 }
});

test('hash, MIME and redirect checks distinguish broken static serving',async t=>{
 for(const [label,response,code] of [
  ['mixed release',()=>new Response('export const sales=false;',{headers:{'Content-Type':'application/javascript'}}),'ASSET_HASH_MISMATCH'],
  ['HTML fallback',()=>new Response('<html>Not found</html>',{headers:{'Content-Type':'text/html'}}),'ASSET_TYPE_INVALID'],
  ['external redirect',()=>new Response(null,{status:302,headers:{Location:'https://external.example.test/login'}}),'UNEXPECTED_REDIRECT'],
 ])await t.test(label,async()=>{const f=fixture();f.overrides.set(site+'/assets/sales.mjs',response);const r=await checkDeployment(site,{fetcher:f.fetcher});assert.equal(r.ok,false);assert.equal(r.checks.find(c=>c.name==='asset:/assets/sales.mjs').code,code);assert.equal(f.calls.some(c=>c.url.startsWith('https://external.')),false);});
 await t.test('same-origin clean URL redirect is supported',async()=>{
  const f=fixture();f.overrides.set(site+'/account.html',()=>new Response(null,{status:308,headers:{Location:'/account'}}));f.overrides.set(site+'/account',()=>new Response(f.files.get('/account.html'),{headers:{'Content-Type':'text/html'}}));assert.equal((await checkDeployment(site,{fetcher:f.fetcher})).ok,true);
 });
});

test('API probes reject missing functions and leaked rows without including response payload',async()=>{
 const f=fixture();f.overrides.set(backend+'/rest/v1/rpc/rpc_open_order',()=>Response.json({code:'PGRST202',message:'Missing'},{status:404}));
 f.overrides.set(backend+'/rest/v1/orders?select=id&limit=1',()=>Response.json([{id:'PRIVATE_ROW_SENTINEL'}]));const r=await checkDeployment(site,{fetcher:f.fetcher});
 assert.equal(r.ok,false);assert.equal(r.checks.find(c=>c.name==='anonymous-rpc:rpc_open_order').code,'RPC_MISSING_OR_ANONYMOUS_ACCESS');assert.equal(r.checks.find(c=>c.name==='anonymous-table:orders').code,'ANONYMOUS_TABLE_NOT_DENIED');assert.equal(JSON.stringify(r).includes('PRIVATE_ROW_SENTINEL'),false);
});

test('manifest traversal and duplicate paths are rejected before fetching them',async()=>{
 for(const bad of ['../private','//external.example.test/key','https://external.example.test/key','/assets/../key']){
  const f=fixture(),m=JSON.parse(f.manifest());m.assets[0].path=bad;f.overrides.set(site+'/deployment-manifest.json',()=>Response.json(m));const r=await checkDeployment(site,{fetcher:f.fetcher});assert.equal(r.ok,false);assert.equal(f.calls.length,1);
 }
 const f=fixture(),m=JSON.parse(f.manifest());m.assets.push(m.assets[0]);f.overrides.set(site+'/deployment-manifest.json',()=>Response.json(m));assert.equal((await checkDeployment(site,{fetcher:f.fetcher})).ok,false);
});

test('static health is never treated as a successful database check; errors are sanitized',async()=>{
 const f=fixture();f.files.set('/health.json',JSON.stringify({status:'STATIC_BUILD_READY',databaseChecked:true}));f.overrides.set(backend+'/auth/v1/settings',()=>{throw new Error('SECRET_FROM_NETWORK');});const r=await checkDeployment(site,{fetcher:f.fetcher});
 assert.equal(r.ok,false);assert.equal(r.checks.find(c=>c.name==='static-health').code,'STATIC_HEALTH_INVALID');assert.equal(JSON.stringify(r).includes('SECRET_FROM_NETWORK'),false);
 assert.equal(r.checks.some(c=>c.name.startsWith('anonymous-')),false);
});

test('Auth email disabled and backend redirects cannot pass or forward the public key',async()=>{
 const f=fixture();f.overrides.set(backend+'/auth/v1/settings',()=>Response.json({external:{email:false}}));let r=await checkDeployment(site,{fetcher:f.fetcher});assert.equal(r.checks.find(c=>c.name==='supabase-auth').code,'AUTH_EMAIL_DISABLED');
 f.calls.length=0;f.overrides.set(backend+'/auth/v1/settings',()=>new Response(null,{status:302,headers:{Location:'https://external.example.test/collect'}}));r=await checkDeployment(site,{fetcher:f.fetcher});assert.equal(r.ok,false);assert.equal(f.calls.some(c=>c.url.startsWith('https://external.')),false);
});

test('unbuilt service worker and local targets require explicit handling',async()=>{
 const f=fixture();f.files.set('/sw.js',"const CACHE='modular-pos-shell-__BUILD_ID__';");assert.equal((await checkDeployment(site,{fetcher:f.fetcher})).ok,false);
 let called=false;const result=await checkDeployment('http://127.0.0.1:3000',{fetcher:()=>{called=true;}});assert.equal(result.ok,false);assert.equal(called,false);
});

test('public configuration accepts publishable or anon keys and rejects privileged or credential URLs',()=>{
 for(const key of ['sb_publishable_example',jwt('anon')])assert.equal(validatePublicConfig({url:backend,key}).key,key);
 assert.deepEqual(validatePublicConfig({url:'',key:''},{allowEmpty:true}),{url:'',key:''});
 for(const key of ['sb_secret_hidden',jwt('service_role'),jwt('authenticated'),'public-key'])assert.throws(()=>validatePublicConfig({url:backend,key}),/SUPABASE_PUBLIC_KEY_REQUIRED/);
 for(const url of ['http://public.example.test','https://user:password@example.test','https://example.test?key=hidden','https://example.test/path'])assert.throws(()=>validatePublicConfig({url,key:jwt('anon')}),/SUPABASE_URL_INVALID/);
 assert.throws(()=>validatePublicConfig({url:backend,key:''},{allowEmpty:true}),/SUPABASE_CONFIG_REQUIRED/);
});

test('build refuses private keys before changing output and emits matching public manifest',{timeout:20000},async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'pos-build-check-'));
 try{
  await cp(path.resolve('public'),path.join(temp,'public'),{recursive:true});const script=path.resolve('scripts/build-vercel.mjs');
  const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:backend,SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_good',NEXT_PUBLIC_SUPABASE_ANON_KEY:'',SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_ANON_KEY:''};
  let result=spawnSync(process.execPath,[script],{cwd:temp,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const before=await readFile(path.join(temp,'public/app-config.js'),'utf8'),manifest=JSON.parse(await readFile(path.join(temp,'public/deployment-manifest.json'),'utf8'));
  assert.equal(manifest.assets.find(a=>a.path==='/app-config.js').sha256,createHash('sha256').update(before).digest('hex'));assert.match(before,/sb_publishable_good/);
  for(const bad of ['sb_secret_NEVER_WRITE',jwt('service_role')]){
   result=spawnSync(process.execPath,[script],{cwd:temp,env:{...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:bad},encoding:'utf8'});assert.notEqual(result.status,0);assert.equal((result.stdout+result.stderr).includes(bad),false);assert.equal(await readFile(path.join(temp,'public/app-config.js'),'utf8'),before);
  }
 }finally{await rm(temp,{recursive:true,force:true});}
});
