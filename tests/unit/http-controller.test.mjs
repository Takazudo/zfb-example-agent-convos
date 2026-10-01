import test from 'node:test';
import assert from 'node:assert/strict';
import { createLab } from '../../build/packages/mock/src/lab.js';
import { ConversationService } from '../../build/packages/core/src/service.js';
import { createHandler } from '../../build/workers/conversations/src/http-handler.js';
import { HttpConversationClient } from '../../build/packages/client/src/http.js';
import { ConversationController, MemoryStorage, latestRun, shouldSendOnEnter } from '../../build/packages/controller/src/controller.js';
import { readBoundedJson, TransportError } from '../../build/packages/client/src/wire.js';
const value = r => { assert.equal(r.ok,true,JSON.stringify(r)); return r.value; };
const deferred = () => { let resolve; const promise = new Promise(r => resolve=r); return {promise,resolve}; };
function override(client, changes) { return new Proxy(client, { get(target, key) { return key in changes ? changes[key] : typeof target[key] === 'function' ? target[key].bind(target) : target[key]; }}); }
async function httpLab() {
  const lab=await createLab();
  const handler=createHandler({resolvePrincipal:async()=>lab.principal,client:()=>lab.client});
  return { ...lab, handler, http:new HttpConversationClient('https://example.test/api/v1',async (url, init)=>handler(new Request(url,init))) };
}
async function empty(lab,title='First') { return value(await lab.client.create({title},{requestKey:lab.clock.id('create')})); }

test('HTTP client and handler run full conversation, review, context, history and skills contract',async()=>{
  const l=await httpLab(); const c=value(await l.http.create({title:'HTTP thread'},{requestKey:'create-http'}));
  value(await l.http.send(c.id,{text:'Create a draft',expectedRevision:c.revision},{requestKey:'send-http'}));
  await l.pump(); const s=value(await l.http.snapshot(c.id)); assert.equal(s.messages.length,2);
  const proposal=s.proposals[0]; value(await l.http.decide(c.id,proposal.id,{decision:'approve',payloadHash:proposal.payloadHash},{requestKey:'approve-http'}));
  await l.pump(); assert.equal(value(await l.http.snapshot(c.id)).proposals[0].status,'applied');
  assert.equal(value(await l.http.context(c.id,s.runs[0].id)).skillPins.length,2);
  assert.equal(value(await l.http.export(c.id)).snapshot.messages.length,2);
  assert.ok(value(await l.http.events(c.id,0)).events.length>0);
  const skills=value(await l.http.skills()); const sid=skills[0].id;
  value(await l.http.saveSkill(sid,{expectedHead:1,body:'# Updated',note:'HTTP edit'},{requestKey:'edit-http'}));
  assert.equal(value(await l.http.restoreSkill(sid,{expectedHead:2,sourceVersion:1},{requestKey:'restore-http'})).version,3);
  assert.equal(value(await l.http.skillHistory(sid)).items.length,3);
});
test('HTTP boundary rejects unauthenticated traffic before client creation',async()=>{
  const h=createHandler({resolvePrincipal:async()=>null,client:()=>{throw Error('must not run');}});
  const r=await h(new Request('https://example.test/api/v1/conversations')); assert.equal(r.status,401); assert.equal((await r.json()).error.code,'UNAUTHENTICATED');
});
test('kill switch fails closed',async()=>{
  const h=createHandler({enabled:()=>false,resolvePrincipal:async()=>{throw Error('must not run');},client:()=>null});
  assert.equal((await h(new Request('https://example.test/api/v1/conversations'))).status,503);
});
test('HTTP origin, query, shape, size, encoding and key guards',async()=>{
  const l=await httpLab(); const base='https://example.test/api/v1/conversations';
  const post=(body,extra={})=>l.handler(new Request(base,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'key',...extra},body}));
  assert.equal((await post('{}',{Origin:'https://attacker.test'})).status,403);
  assert.equal((await post('{}',{'Idempotency-Key':''})).status,400);
  assert.equal((await post('{')).status,400);
  assert.equal((await post(JSON.stringify({actorId:'admin'}))).status,400);
  assert.equal((await post(JSON.stringify({title:'a'.repeat(70000)}))).status,400);
  assert.equal((await l.handler(new Request(base+'?archived=true&archived=false'))).status,400);
  assert.equal((await l.handler(new Request(base+'/%zz'))).status,400);
  const r=await l.handler(new Request(base)); assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('internal errors never return original exception details',async()=>{
  const l=await createLab(); const h=createHandler({resolvePrincipal:async()=>l.principal,client:()=>override(l.client,{list:async()=>{throw Error('SECRET token password');}})});
  const r=await h(new Request('https://example.test/api/v1/conversations')); assert.equal(r.status,503); assert.doesNotMatch(await r.text(),/SECRET|token|password/);
});
for (const [name,response] of [
  ['HTML fallback',()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}})],
  ['invalid entity',()=>Response.json({ok:true,value:{items:[{id:'wrong'}],nextCursor:null},requestId:'request'})],
  ['status disagreement',()=>Response.json({ok:false,error:{code:'NOT_FOUND',message:'No',retryable:false},requestId:'request'})],
  ['extra fields',()=>Response.json({ok:true,value:{items:[],nextCursor:null},requestId:'request',secret:'x'})],
]) test(`HTTP client rejects ${name}`,async()=>{
  const c=new HttpConversationClient('/api/v1',async()=>response()); await assert.rejects(c.list({}),TransportError);
});
test('HTTP client does not retry an ambiguous mutation; preserves caller key',async()=>{
  let calls=0,seen; const c=new HttpConversationClient('/api/v1',async(_,init)=>{calls++;seen=init;throw Error('offline');});
  await assert.rejects(c.create({title:'new'},{requestKey:'same-key'}),e=>e.kind==='network');
  assert.equal(calls,1);assert.equal(seen.headers['Idempotency-Key'],'same-key');assert.equal(seen.credentials,'same-origin');
});
test('HTTP cancellation stops the wait before issuing a request, not a durable run',async()=>{
  let calls=0; const a=new AbortController();a.abort(); const c=new HttpConversationClient('/api/v1',async()=>{calls++;return Response.json({});});
  await assert.rejects(c.snapshot('conv',{signal:a.signal}.signal),e=>e.kind==='aborted');assert.equal(calls,0);
});
test('bounded JSON reader cancels a stream once limit is exceeded',async()=>{
  let cancelled=false;const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(10));},cancel(){cancelled=true;}});
  await assert.rejects(readBoundedJson(body,15)); assert.equal(cancelled,true);
});
test('controller preserves pre-activation input over stored draft',async()=>{
  const l=await createLab(),c=await empty(l),storage=new MemoryStorage();storage.set(`draft:${c.id}`,'old saved draft');
  const ctrl=new ConversationController(l.client,storage);await ctrl.start('typed before activation');assert.equal(ctrl.state.draft,'typed before activation');ctrl.dispose();
});
test('controller keeps intentional empty drafts and each thread draft',async()=>{
  const l=await createLab(),a=await empty(l),b=await empty(l,'Second'),ctrl=new ConversationController(l.client);
  await ctrl.select(a.id);ctrl.setDraft('first draft');await ctrl.select(b.id);ctrl.setDraft('second draft');await ctrl.select(a.id);assert.equal(ctrl.state.draft,'first draft');
  ctrl.setDraft('');await ctrl.select(b.id);assert.equal(ctrl.state.draft,'second draft');await ctrl.select(a.id);assert.equal(ctrl.state.draft,'');ctrl.dispose();
});
test('late snapshot from previous thread cannot overwrite selected view',async()=>{
  const l=await createLab(),a=await empty(l),b=await empty(l,'Second'),gate=deferred();
  const client=override(l.client,{snapshot:async cid=>cid===a.id ? gate.promise : l.client.snapshot(cid)});
  const ctrl=new ConversationController(client);const waiting=ctrl.select(a.id);await ctrl.select(b.id);gate.resolve(await l.client.snapshot(a.id));await waiting;
  assert.equal(ctrl.state.projection.conversation.id,b.id);ctrl.dispose();
});
test('controller refuses an obsolete snapshot after a newer snapshot',async()=>{
  const l=await createLab(),c=await empty(l),old=await l.client.snapshot(c.id),gate=deferred();let delayed=false;
  const client=override(l.client,{snapshot:async cid=>delayed ? (delayed=false,gate.promise) : l.client.snapshot(cid)});
  const ctrl=new ConversationController(client);await ctrl.select(c.id);delayed=true;const pending=ctrl.refresh();
  value(await l.client.send(c.id,{text:'new',expectedRevision:c.revision},{requestKey:'new'}));await ctrl.refresh();const cursor=ctrl.state.projection.cursor;
  gate.resolve(old);await pending;assert.equal(ctrl.state.projection.cursor,cursor);ctrl.dispose();
});
test('lost send response is recovered after controller recreation with same key and no duplicate message',async()=>{
  const l=await createLab(),c=await empty(l),storage=new MemoryStorage(),keys=[];let drop=true;
  const client=override(l.client,{send:async(cid,input,opts)=>{keys.push(opts.requestKey);const r=await l.client.send(cid,input,opts);if(drop){drop=false;throw new TransportError('network','lost response');}return r;}});
  const first=new ConversationController(client,storage);await first.select(c.id);first.setDraft('only one');await first.send();assert.ok(first.state.pending);first.dispose();
  const second=new ConversationController(client,storage);await second.select(c.id);await second.retryPending();assert.equal(second.state.pending,null);assert.equal(second.state.draft,'');assert.equal(keys[0],keys[1]);assert.equal(value(await l.client.snapshot(c.id)).messages.length,1);second.dispose();
});
test('a new draft entered during send is not cleared by the old acknowledgement',async()=>{
  const l=await createLab(),c=await empty(l),gate=deferred();const client=override(l.client,{send:async(...args)=>{const r=await l.client.send(...args);await gate.promise;return r;}});
  const ctrl=new ConversationController(client);await ctrl.select(c.id);ctrl.setDraft('sent');const sending=ctrl.send();ctrl.setDraft('new draft');gate.resolve();await sending;assert.equal(ctrl.state.draft,'new draft');ctrl.dispose();
});
test('controller retries an approval with the retained key after lost acknowledgement',async()=>{
  const l=await createLab(),c=await empty(l);value(await l.client.send(c.id,{text:'draft',expectedRevision:c.revision},{requestKey:'send'}));await l.pump();let drop=true;const keys=[];
  const client=override(l.client,{decide:async(...args)=>{keys.push(args[3].requestKey);const r=await l.client.decide(...args);if(drop){drop=false;throw new TransportError('network','lost');}return r;}});
  const ctrl=new ConversationController(client);await ctrl.select(c.id);await ctrl.decide(Object.values(ctrl.state.projection.proposals)[0],'approve');assert.equal(ctrl.state.pending.kind,'decide');await ctrl.retryPending();await l.pump();assert.equal(keys[0],keys[1]);assert.equal(l.host.store.writes,1);ctrl.dispose();
});
test('malformed persisted pending command does not block a valid future send',async()=>{
  const l=await createLab(),c=await empty(l),storage=new MemoryStorage();storage.set(`pending:${c.id}`,JSON.stringify({cid:c.id,key:'k',kind:'send',input:null}));
  const ctrl=new ConversationController(l.client,storage);await ctrl.select(c.id);assert.equal(ctrl.state.pending,null);ctrl.setDraft('valid');await ctrl.send();assert.equal(value(await l.client.snapshot(c.id)).messages.length,1);ctrl.dispose();
});
test('storage denial degrades explicitly without blocking in-memory editing',async()=>{
  const l=await createLab(),c=await empty(l),storage={get(){throw Error();},set(){throw Error();},remove(){throw Error();}};
  const ctrl=new ConversationController(l.client,storage);await ctrl.select(c.id);ctrl.setDraft('retained');assert.equal(ctrl.state.draft,'retained');assert.equal(ctrl.state.storageAvailable,false);ctrl.dispose();
});
test('disposal unsubscribes locally and never requests server cancellation',async()=>{
  const l=await createLab(),c=await empty(l);let cancels=0,notices=0;const client=override(l.client,{cancel:async()=>{cancels++;}});
  const ctrl=new ConversationController(client);ctrl.subscribe(()=>notices++);await ctrl.select(c.id);const before=notices;ctrl.dispose();ctrl.setDraft('after');assert.equal(notices,before);assert.equal(cancels,0);
});
test('Japanese Enter guards composition, key 229 and Shift+Enter',()=>{
  const e={key:'Enter',shiftKey:false,isComposing:false,keyCode:13};assert.equal(shouldSendOnEnter(e,false),true);
  for(const [event,comp]of [[{...e,isComposing:true},false],[{...e,keyCode:229},false],[e,true],[{...e,shiftKey:true},false]])assert.equal(shouldSendOnEnter(event,comp),false);
});

test('latest run uses active identity and retry ancestry rather than random ID tie-breaks',()=>{
 const p={conversation:{activeRun:null},runs:{zold:{id:'zold',inputMessageId:'m1',createdAt:'2026-09-30',retryOfRunId:null,refreshOfProposalId:null},anew:{id:'anew',inputMessageId:'m1',createdAt:'2026-09-30',retryOfRunId:'zold',refreshOfProposalId:null}},messages:{m1:{createdSeq:2}},proposals:{}};
 assert.equal(latestRun(p).id,'anew');
 p.runs.bnext={id:'bnext',inputMessageId:'m2',createdAt:'2026-09-30',retryOfRunId:null,refreshOfProposalId:null};p.messages.m2={createdSeq:12};assert.equal(latestRun(p).id,'bnext');
 p.conversation.activeRun={id:'anew',status:'running'};assert.equal(latestRun(p).id,'anew');
});

test('default HTTP transport calls native fetch without binding it to the client',async()=>{
  const original=globalThis.fetch;
  let receiver;
  globalThis.fetch=function(){receiver=this;return Promise.resolve(Response.json({ok:true,value:{items:[],nextCursor:null},requestId:'test'}));};
  try {
    const client=new HttpConversationClient('/api/v1');
    assert.equal((await client.list({})).ok,true);
    assert.ok(receiver===undefined || receiver===globalThis, 'fetch must not receive HttpConversationClient as its receiver');
  } finally {globalThis.fetch=original;}
});

test('event replay updates the selected conversation sidebar run status',async()=>{
  const lab=await createLab();await empty(lab);
  const controller=new ConversationController(lab.client);
  await controller.start();controller.setDraft('Prepare a draft');await controller.send();
  assert.equal(controller.state.conversations.find(c=>c.id===controller.state.selectedId).activeRun.status,'queued');
  await lab.pump();await controller.poll();
  assert.equal(controller.state.conversations.find(c=>c.id===controller.state.selectedId).activeRun.status,'awaiting_approval');
  const proposal=Object.values(controller.state.projection.proposals)[0];
  await controller.decide(proposal,'approve');await lab.pump();await controller.poll();
  assert.equal(controller.state.conversations.find(c=>c.id===controller.state.selectedId).activeRun,null);
  controller.dispose();
});
