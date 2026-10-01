import test from 'node:test';import assert from 'node:assert/strict';
import {request as rawRequest} from 'node:http';
import {spawn} from 'node:child_process';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{createServer}from'node:net';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const status=(url,headers)=>new Promise((resolve,reject)=>{const r=rawRequest(url,{headers},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function start(port,db){const child=spawn(process.execPath,['dev/server.mjs'],{env:{...process.env,PORT:String(port),CONVOS_DB:db},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok)return child;}catch{}if(child.exitCode!==null)break;await delay(50);}child.kill('SIGTERM');throw Error(log||'Server did not become ready');}
async function stop(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Server did not shut down'));},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
const unwrap=async r=>{const j=await r.json();assert.equal(j.ok,true,JSON.stringify(j));return j.value;};
test('loopback server exercises real HTTP, background fake jobs, host receipts and restart persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'convos-http-')),port=await freePort(),db=join(dir,'state.sqlite'),base=`http://127.0.0.1:${port}`;let child=await start(port,db);
 const post=(path,body,key)=>fetch(base+'/api/v1'+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
 try{
  const health=await(await fetch(base+'/health')).json();assert.equal(health.cloudflare,false);assert.equal(health.provider,'fake');
  const c=await unwrap(await post('/conversations',{title:'Persist across restart'},'create-persist'));await unwrap(await post(`/conversations/${c.id}/messages`,{text:'Backend continues without a browser.',expectedRevision:c.revision},'send-persist'));
  let snapshot;for(let i=0;i<60;i++){snapshot=await unwrap(await fetch(base+`/api/v1/conversations/${c.id}`));if(snapshot.proposals.length)break;await delay(60);}assert.equal(snapshot.proposals.length,1);
  const p=snapshot.proposals[0];await unwrap(await post(`/conversations/${c.id}/proposals/${p.id}/decision`,{decision:'approve',payloadHash:p.payloadHash},'approve-persist'));
  for(let i=0;i<60;i++){snapshot=await unwrap(await fetch(base+`/api/v1/conversations/${c.id}`));if(snapshot.proposals[0].status==='applied')break;await delay(50);}assert.equal(snapshot.proposals[0].status,'applied');
  const host=await(await fetch(base+'/__dev/host')).json();assert.match(host.text,/Backend continues/);
  await stop(child);child=await start(port,db);
  const after=await unwrap(await fetch(base+`/api/v1/conversations/${c.id}`));assert.deepEqual(after,snapshot);assert.deepEqual(await(await fetch(base+'/__dev/host')).json(),host);
  const repeat=await unwrap(await post(`/conversations/${c.id}/proposals/${p.id}/decision`,{decision:'approve',payloadHash:p.payloadHash},'approve-persist'));assert.equal(repeat.id,p.id);assert.deepEqual(await(await fetch(base+'/__dev/host')).json(),host);
 }finally{await stop(child);rmSync(dir,{recursive:true,force:true});}
});
test('local server denies hostile Host, Origin, cross-site fetch and unknown files',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'convos-boundary-')),port=await freePort();const child=await start(port,join(dir,'state.sqlite')),base=`http://127.0.0.1:${port}`;
 try{
  assert.equal(await status(base+'/health',{Host:'evil.test'}),403);
  assert.equal(await status(base+'/api/v1/conversations',{Origin:'https://evil.test'}),403);
  assert.equal(await status(base+'/health',{'Sec-Fetch-Site':'cross-site'}),403);
  assert.equal((await fetch(base+'/../.dev-state/conversations.sqlite')).status,404);
  const root=await fetch(base+'/workbench');assert.equal(root.status,200);assert.match(root.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 }finally{await stop(child);rmSync(dir,{recursive:true,force:true});}
});
