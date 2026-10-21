// Validate key type only. Supabase, not this parser, verifies key authenticity.
export function validatePublicConfig({url,key},{allowEmpty=false,allowLocal=true}={}){
 if(allowEmpty&&!url&&!key)return {url:'',key:''};
 if(typeof url!=='string'||typeof key!=='string'||!url||!key)throw new Error('SUPABASE_CONFIG_REQUIRED');
 let parsed;try{parsed=new URL(url);}catch{throw new Error('SUPABASE_URL_INVALID');}
 const local=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
 if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||
  (parsed.protocol!=='https:'&&!(allowLocal&&local&&parsed.protocol==='http:'))||(!allowLocal&&local))throw new Error('SUPABASE_URL_INVALID');
 let publicKey=false;
 if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))publicKey=true;
 else{
  const parts=key.split('.');
  if(parts.length===3&&parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p))){
   try{publicKey=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')).role==='anon';}catch{}
  }
 }
 if(!publicKey)throw new Error('SUPABASE_PUBLIC_KEY_REQUIRED');
 return {url:parsed.origin,key};
}
