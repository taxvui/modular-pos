import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {AuthClient} from '../../public/assets/auth-client.mjs';

test('real Auth rotates once for concurrent requests and rejected refresh ends the local session',{timeout:90000},async()=>{
 const config=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const url=config.API_URL??config.api_url,key=config.ANON_KEY??config.anon_key,service=config.SERVICE_ROLE_KEY??config.service_role_key;
 assert.ok(url&&key&&service);assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'Local Supabase only');
 const suffix=randomUUID().slice(0,8),email='session-api-'+suffix+'@example.test',password=randomUUID();
 const created=await fetch(url+'/auth/v1/admin/users',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})});
 assert.ok(created.ok,'Create local Auth fixture: HTTP '+created.status);
 let rotations=0,expireAccess=false,revoked=false;
 const ended=[];
 const c=new AuthClient({url,key,onSessionEnd:e=>ended.push(e.reason),fetcher:async(path,options)=>{
  // Expire the access token at the HTTP boundary; the refresh exchange itself is real.
  if(path.endsWith('grant_type=refresh_token')){
   rotations++;expireAccess=false;
   if(revoked)options={...options,body:JSON.stringify({refresh_token:'revoked-fixture-token'})};
  }
  if(expireAccess&&path.includes('/rest/'))return new Response(JSON.stringify({code:'PGRST301'}),{status:401,headers:{'Content-Type':'application/json'}});
  return fetch(path,options);
 }});
 await c.signIn(email,password);
 const workspace=await c.bootstrap({name:'Session '+suffix,slug:'session-'+suffix,storeName:'Main',address:'Test'});
 expireAccess=true;
 const results=await Promise.all([c.stores(),c.organizations(),c.stores()]);
 assert.equal(rotations,1);assert.equal(results[0][0].id,workspace.store_id);assert.equal(c.signedIn,true);
 await c.refreshSession();assert.equal(rotations,2);assert.equal((await c.stores())[0].id,workspace.store_id);
 expireAccess=true;revoked=true;
 await assert.rejects(c.stores(),/AUTH_REQUIRED/);assert.equal(c.signedIn,false);assert.equal(c.userId,null);assert.deepEqual(ended,['EXPIRED']);
});
