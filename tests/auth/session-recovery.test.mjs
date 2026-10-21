import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthClient} from '../../public/assets/auth-client.mjs';
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const session=(token='a',refresh='r1',id='u',extra={})=>({access_token:token,refresh_token:refresh,user:{id,email:id+'@example.test'},...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const client=(fetcher,extra={})=>new AuthClient({url:'https://example.supabase.co',key:'public',fetcher,...extra});

test('parallel requests share one rotation and use the rotated refresh token next time',async()=>{
 let clock=100000,rotations=0;const barrier=deferred(),calls=[];
 const c=client(async(url,options)=>{
  calls.push({url,...options});
  if(url.endsWith('grant_type=password'))return response(session('a','r1','u',{expires_at:101}));
  if(url.endsWith('grant_type=refresh_token')){rotations++;if(rotations===1)await barrier.promise;return response(session('a'+rotations,'r'+(rotations+1),'u',{expires_in:3600}));}
  return response([]);
 },{now:()=>clock});
 await c.signIn('u@example.test','password');const pending=[c.stores(),c.organizations(),c.stores()];await Promise.resolve();barrier.resolve();await Promise.all(pending);
 assert.equal(rotations,1);assert.ok(calls.filter(x=>x.url.includes('/rest/')).every(x=>x.headers.Authorization==='Bearer a1'));
 clock+=3600000;await c.stores();assert.equal(rotations,2);
 assert.deepEqual(calls.filter(x=>x.url.endsWith('grant_type=refresh_token')).map(x=>JSON.parse(x.body)),[{refresh_token:'r1'},{refresh_token:'r2'}]);
 assert.equal(JSON.stringify(c).includes('r2'),false);
});

test('concurrent 401s retry once with the same mutation payload and operation ID',async()=>{
 let rotations=0;const calls=[];
 const c=client(async(url,options)=>{
  if(url.endsWith('grant_type=password'))return response(session());
  if(url.endsWith('grant_type=refresh_token')){rotations++;return response(session('new','rotated'));}
  calls.push(options);return options.headers.Authorization==='Bearer a'?response({},401):response({id:'receipt'});
 });
 await c.signIn('u@example.test','password');
 const body={p_operation_id:'stable-id',p_amount:1000};await Promise.all([c.request('/rest/v1/rpc/collect',{method:'POST',body}),c.stores()]);
 assert.equal(rotations,1);const writes=calls.filter(x=>x.method==='POST');assert.equal(writes.length,2);assert.equal(writes[0].body,writes[1].body);
 assert.equal(writes[1].headers.Authorization,'Bearer new');
});

test('a late rejection of the old token uses an already rotated token without rotating again',async()=>{
 const slow=deferred();let reads=0,rotations=0;
 const c=client(async(url,options)=>{
  if(url.endsWith('grant_type=password'))return response(session());
  if(url.endsWith('grant_type=refresh_token')){rotations++;return response(session('new','rotated'));}
  if(options.headers.Authorization==='Bearer a'){if(++reads===1)await slow.promise;return response({},401);}return response([]);
 });
 await c.signIn('u@example.test','password');const first=c.stores();await c.organizations();slow.resolve();await first;assert.equal(rotations,1);
});

test('rejected refresh or a second 401 ends the session once without a retry loop',async()=>{
 for(const rejectRefresh of [true,false]){
  let rotations=0,reads=0;const ended=[];
  const c=client(async url=>{
   if(url.endsWith('grant_type=password'))return response(session());
   if(url.endsWith('grant_type=refresh_token')){rotations++;return rejectRefresh?response({error_code:'refresh_token_not_found'},400):response(session('new','next'));}
   reads++;return response({},401);
  },{onSessionEnd:e=>ended.push(e.reason)});
  await c.signIn('u@example.test','password');await assert.rejects(c.stores(),/AUTH_REQUIRED/);
  assert.equal(c.signedIn,false);assert.equal(c.userId,null);assert.equal(rotations,1);assert.equal(reads,rejectRefresh?1:2);assert.deepEqual(ended,['EXPIRED']);
 }
});

test('temporary refresh failures preserve the session and never retry a mutation automatically',async()=>{
 for(const failure of [new TypeError('Network failure'),503,429]){
  let fail=true,writes=0;
  const c=client(async url=>{
   if(url.endsWith('grant_type=password'))return response(session('a','r1','u',{expires_in:1}));
   if(url.endsWith('grant_type=refresh_token')){if(fail){if(failure instanceof Error)throw failure;return response({},failure);}return response(session('new','next','u',{expires_in:3600}));}
   writes++;return response({});
  });
  await c.signIn('u@example.test','password');await assert.rejects(c.request('/rest/write',{method:'POST',body:{operation:'same'}}));
  assert.equal(c.signedIn,true);assert.equal(writes,0);fail=false;await c.stores();assert.equal(writes,1);
 }
});

test('permission denials and server errors never rotate or replay writes',async()=>{
 for(const status of [403,409,429,500,503]){
  let writes=0,rotations=0;
  const c=client(async url=>{
   if(url.endsWith('grant_type=password'))return response(session());
   if(url.endsWith('grant_type=refresh_token'))rotations++;
   writes++;return response({message:'PERMISSION_DENIED'},status);
  });
  await c.signIn('u@example.test','password');await assert.rejects(c.request('/rest/write',{method:'POST',body:{operation:'same'}}));assert.equal(writes,1);assert.equal(rotations,0);assert.equal(c.signedIn,true);
 }
});

test('logout clears immediately and an in-flight rotation cannot restore the session',async()=>{
 const rotated=deferred(),loggedOut=deferred();let started;const startedPromise=new Promise(r=>started=r);
 const c=client(async url=>{
  if(url.endsWith('grant_type=password'))return response(session());
  if(url.endsWith('grant_type=refresh_token')){started();await rotated.promise;return response(session('new','next'));}
  if(url.endsWith('/logout')){await loggedOut.promise;return response({});}
  return response([],401);
 });
 await c.signIn('u@example.test','password');const refresh=c.refreshSession();await startedPromise;
 const logout=c.signOut();assert.equal(c.signedIn,false);rotated.resolve();await assert.rejects(refresh,/SESSION_CHANGED/);assert.equal(c.signedIn,false);loggedOut.resolve();await logout;
});

test('old requests and rotations cannot clear or populate a newly signed-in account',async()=>{
 for(const action of ['request','refresh']){
  const pending=deferred();let user='u';
  const c=client(async url=>{
   if(url.endsWith('grant_type=password'))return response(session(user,'r-'+user,user));
   await pending.promise;return action==='request'?response({},401):response(session('old-new','old-next','u'));
  });
  await c.signIn('u@example.test','password');const old=action==='request'?c.stores():c.refreshSession();user='other';await c.signIn('other@example.test','password');pending.resolve();await assert.rejects(old,/SESSION_CHANGED/);assert.equal(c.userId,'other');assert.equal(c.signedIn,true);
 }
});

test('rotation cannot change identity and malformed successful rotations require a new sign-in',async()=>{
 for(const result of [response(session('new','next','other')),response({access_token:'new',user:{id:'u'}}),{ok:true,status:200,json:async()=>{throw new SyntaxError('broken JSON');}}]){
  const c=client(async url=>url.endsWith('grant_type=password')?response(session()):result);
  await c.signIn('u@example.test','password');await assert.rejects(c.refreshSession());assert.equal(c.signedIn,false);
 }
});

test('mutation retries preserve the submitted payload even if the caller edits its object',async()=>{
 const received=[],rejected=deferred();
 const c=client(async(url,options)=>{
  if(url.endsWith('grant_type=password'))return response(session());
  if(url.endsWith('grant_type=refresh_token'))return response(session('new','next'));
  received.push(options.body);if(received.length===1){await rejected.promise;return response({},401);}return response({});
 });
 await c.signIn('u@example.test','password');const body={operation:'original',amount:1000};const request=c.request('/rest/write',{method:'POST',body});
 body.operation='changed';body.amount=9000;rejected.resolve();await request;
 assert.deepEqual(received,['{"operation":"original","amount":1000}','{"operation":"original","amount":1000}']);
});
