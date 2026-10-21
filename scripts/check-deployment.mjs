import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validatePublicConfig} from './public-config.mjs';

class CheckError extends Error { constructor(code){super(code);this.code=code;} }
const fail=code=>{throw new CheckError(code);};
const nil='00000000-0000-0000-0000-000000000000';
const rpcProbes={rpc_store_context:{},rpc_order_history:{},rpc_shift_history:{},rpc_order_receipt:{p_order_id:nil},rpc_order_events:{p_order_id:nil},rpc_open_order:{p_order_id:nil}};
const json=body=>{try{return JSON.parse(body.toString('utf8'));}catch{fail('INVALID_JSON');}};

// No sign-in, credentials from operators, sale writes or automatic remediation.
export async function checkDeployment(siteUrl,{allowLocal=false,timeoutMs=10000,fetcher=globalThis.fetch}={}){
 const checks=[],report=()=>({ok:checks.every(c=>c.ok),checks,notVerified:['SIGNED_IN_SALES','EMAIL_DELIVERY','BACKUP_RESTORE','PHYSICAL_DEVICES']});
 const step=async(name,action)=>{try{const value=await action();checks.push({name,ok:true});return value;}catch(error){checks.push({name,ok:false,code:error instanceof CheckError?error.code:'REQUEST_FAILED'});return null;}};
 const origin=await step('site-url',()=>{
  let u;try{u=new URL(siteUrl);}catch{fail('SITE_URL_INVALID');}
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(!allowLocal&&local)||(u.protocol!=='https:'&&!(allowLocal&&local&&u.protocol==='http:')))fail('SITE_URL_INVALID');
  return u.origin;
 });if(!origin)return report();
 const read=async(url,options={},redirects=false)=>{
  const signal=AbortSignal.timeout(Math.max(100,Math.min(30000,timeoutMs)));let response;
  for(let i=0;i<4;i++){
   response=await fetcher(url,{...options,cache:'no-store',redirect:'manual',signal});
   if(response.status<300||response.status>=400)break;
   const location=response.headers.get('location');await response.body?.cancel();
   if(!redirects||!location||i===3)fail('UNEXPECTED_REDIRECT');
   const next=new URL(location,url);if(next.origin!==new URL(url).origin||next.username||next.password)fail('UNEXPECTED_REDIRECT');url=next.href;
  }
  const chunks=[];let size=0;
  if(response.body){const reader=response.body.getReader();for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2097152){await reader.cancel();fail('RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(part.value));}}
  return {status:response.status,headers:response.headers,body:Buffer.concat(chunks)};
 };
 const manifest=await step('deployment-manifest',async()=>{
  const r=await read(origin+'/deployment-manifest.json',{},true);if(r.status!==200||!r.headers.get('content-type')?.includes('application/json'))fail('MANIFEST_UNAVAILABLE');
  const m=json(r.body);
  if(m.version!==1||!/^[a-f0-9]{20}$/.test(m.buildId)||!Array.isArray(m.assets)||m.assets.length<4||m.assets.length>100)fail('MANIFEST_INVALID');
  const paths=new Set();
  for(const a of m.assets){if(typeof a.path!=='string'||!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(a.path)||a.path.split('/').some(p=>p==='.'||p==='..')||!/^([a-f0-9]{64})$/.test(a.sha256)||paths.has(a.path))fail('MANIFEST_INVALID');paths.add(a.path);}
  if(!['/account.html','/app-config.js','/sw.js','/health.json','/assets/account.mjs','/assets/sales.mjs'].every(p=>paths.has(p)))fail('MANIFEST_INVALID');return m;
 });if(!manifest)return report();
 const files=new Map();
 for(const asset of manifest.assets){await step('asset:'+asset.path,async()=>{
  const r=await read(origin+asset.path,{},true);if(r.status!==200)fail('ASSET_UNAVAILABLE');
  const mime=r.headers.get('content-type')||'';
  if((/\.(js|mjs)$/.test(asset.path)&&!/(java|ecma)script/.test(mime))||(asset.path.endsWith('.json')&&!mime.includes('application/json'))||(asset.path.endsWith('.html')&&!mime.includes('text/html')))fail('ASSET_TYPE_INVALID');
  if(createHash('sha256').update(r.body).digest('hex')!==asset.sha256)fail('ASSET_HASH_MISMATCH');files.set(asset.path,r.body);
 });}
 const config=await step('public-config',()=>{
  const raw=files.get('/app-config.js')?.toString('utf8'),match=raw?.match(/^window\.MODULAR_POS_CONFIG\s*=\s*(\{[^]*\});?\s*$/);
  if(!match)fail('PUBLIC_CONFIG_INVALID');let value;try{value=validatePublicConfig(json(Buffer.from(match[1])),{allowLocal});}catch{fail('PUBLIC_CONFIG_INVALID');}return value;
 });
 await step('static-health',()=>{const h=json(files.get('/health.json')||Buffer.alloc(0));if(h.status!=='STATIC_BUILD_READY'||h.databaseChecked!==false)fail('STATIC_HEALTH_INVALID');});
 await step('service-worker',()=>{const sw=files.get('/sw.js')?.toString('utf8')||'';if(sw.includes('__BUILD_ID__')||!sw.includes('modular-pos-shell-'+manifest.buildId))fail('SERVICE_WORKER_INVALID');});
 if(!config)return report();
 const headers={apikey:config.key,'Content-Type':'application/json'};
 const auth=await step('supabase-auth',async()=>{const r=await read(config.url+'/auth/v1/settings',{headers});if(r.status!==200)fail('AUTH_UNAVAILABLE');if(json(r.body).external?.email!==true)fail('AUTH_EMAIL_DISABLED');return true;});
 if(!auth)return report();
 for(const table of ['organizations','orders','payments','refunds','audit_logs'])await step('anonymous-table:'+table,async()=>{
  const r=await read(config.url+'/rest/v1/'+table+'?select=id&limit=1',{headers}),body=json(r.body);
  if(r.status===200&&Array.isArray(body)&&body.length===0)return;
  if([401,403].includes(r.status)&&body.code==='42501')return;
  fail('ANONYMOUS_TABLE_NOT_DENIED');
 });
 for(const [name,args] of Object.entries(rpcProbes))await step('anonymous-rpc:'+name,async()=>{
  const r=await read(config.url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify({p_org_id:nil,p_store_id:nil,...args})}),body=json(r.body);
  if(![401,403].includes(r.status)||body.code!=='42501')fail('RPC_MISSING_OR_ANONYMOUS_ACCESS');
 });
 return report();
}

async function main(){
 const args=process.argv.slice(2);let url,allowLocal=false,asJson=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--url')url=args[++i];else if(args[i]==='--allow-local')allowLocal=true;else if(args[i]==='--json')asJson=true;else{process.stderr.write('Usage: npm run check:deployment -- --url https://pos.example.com [--allow-local] [--json]\n');process.exitCode=2;return;}}
 const result=await checkDeployment(url,{allowLocal});
 process.stdout.write(asJson?JSON.stringify(result,null,2)+'\n':result.checks.map(c=>(c.ok?'PASS ':'FAIL ')+c.name+(c.code?' '+c.code:'')).join('\n')+'\nChưa kiểm chứng: bán hàng đăng nhập, email thực nhận, backup/restore và thiết bị thật.\n');
 process.exitCode=result.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('DEPLOYMENT_CHECK_FAILED\n');process.exitCode=1;});
