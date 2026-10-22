import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AuthClient } from '../../public/assets/auth-client.mjs';

const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k), data }; };
const session = (refresh = 'refresh-1') => ({ access_token: 'access', refresh_token: refresh, user: { id: 'owner', email: 'owner@example.test' }, expires_in: 3600 });
const client = (saved, fetcher) => new AuthClient({ url: 'https://example.supabase.co', key: 'public-key', sessionStorage: saved, fetcher });

test('navigation restores a session through Auth and persists the rotated credential', async () => {
 const saved = storage();
 await client(saved, async () => response(session())).signIn('owner@example.test', 'password-never-saved');
 assert.doesNotMatch(JSON.stringify([...saved.data]), /password-never-saved|access_token/);
 const requests = [];
 const reloaded = client(saved, async (url, options) => { requests.push({ url, options }); return response(requests.length === 1 ? session('refresh-2') : []); });
 assert.equal(reloaded.signedIn, false);
 assert.deepEqual(await reloaded.restoreSession(), { id: 'owner', email: 'owner@example.test' });
 assert.equal(requests[0].url, 'https://example.supabase.co/auth/v1/token?grant_type=refresh_token');
 assert.deepEqual(JSON.parse(requests[0].options.body), { refresh_token: 'refresh-1' });
 await reloaded.stores();
 assert.equal(requests[1].options.headers.Authorization, 'Bearer access');
 assert.match(JSON.stringify([...saved.data]), /refresh-2/);
 await reloaded.signOut();
 assert.equal(saved.data.size, 0);
 assert.equal(await client(saved, async () => { throw new Error('unexpected request'); }).restoreSession(), null);
});

test('rejected credentials and changed identities never restore access', async () => {
 for (const reply of [response({ error_code: 'refresh_token_not_found' },400), response({ ...session(), user: { id: 'other' } })]) {
  const saved=storage(); await client(saved,async()=>response(session())).signIn('a','password');
  const reloaded=client(saved,async()=>reply);
  await assert.rejects(reloaded.restoreSession());
  assert.equal(reloaded.signedIn,false); assert.equal(saved.data.size,0);
 }
});

test('temporary failures retain the saved credential without opening a workspace', async () => {
 const saved=storage(); await client(saved,async()=>response(session())).signIn('a','password');
 const reloaded=client(saved,async()=>response({},503));
 await assert.rejects(reloaded.restoreSession());
 assert.equal(reloaded.signedIn,false); assert.equal(saved.data.size,1);
});

test('logout wins over an in-flight restore and disabled storage still allows login', async () => {
 const saved=storage(); await client(saved,async()=>response(session())).signIn('a','password');
 let finish; const reloaded=client(saved,()=>new Promise(resolve=>{finish=resolve;}));
 const pending=reloaded.restoreSession(); await reloaded.signOut(); finish(response(session()));
 await assert.rejects(pending,/SESSION_CHANGED/); assert.equal(reloaded.signedIn,false); assert.equal(saved.data.size,0);
 const unavailable={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
 const c=client(unavailable,async()=>response(session()));
 assert.equal(await c.restoreSession(),null); await c.signIn('a','password'); assert.equal(c.signedIn,true);
});

test('production root redirects to the real account page before serving the demo index',async()=>{
 const config=JSON.parse(await readFile('vercel.json','utf8'));
 assert.deepEqual(config.redirects.find(r=>r.source==='/'),{source:'/',destination:'/account',permanent:false});
});
