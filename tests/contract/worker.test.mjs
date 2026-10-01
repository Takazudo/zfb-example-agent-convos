import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '../../dev/sqlite.mjs';
import { SqliteHostStore } from '../../dev/sqlite-host.mjs';
import { createLab } from '../../build/packages/mock/src/lab.js';
import { DemoHost } from '../../build/packages/mock/src/demo-host.js';
import { D1Repository } from '../../build/workers/conversations/src/d1-repository.js';
import { createConversationWorker } from '../../build/workers/conversations/src/worker.js';
import { HttpConversationClient } from '../../build/packages/client/src/http.js';
const value=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
function worker(lab,db,extra={}){const queue=[];const w=createConversationWorker({database:db,queue:{async send(body){queue.push(body);}},host:lab.host,provider:lab.provider,authenticate:async()=>lab.principal,resolveAuthority:async()=>lab.principal,clock:lab.clock,...extra});return{...w,messages:queue};}

test('Worker composition is disabled unless enabled explicitly',async()=>{
 const db=new SqliteAdapter();try{const l=await createLab({repository:new D1Repository(db)}),w=worker(l,db);assert.equal((await w.fetch(new Request('https://example.test/api/v1/conversations'))).status,503);let retry=0;await w.queue({messages:[{body:{},ack(){throw Error('must not ack');},retry(){retry++;}}]});assert.equal(retry,1);await w.scheduled();assert.equal(w.messages.length,0);}finally{db.close();}
});
test('Worker handler factory executes durable fake jobs through scheduled outbox and queue ingress',async()=>{
 const db=new SqliteAdapter();try{const l=await createLab({repository:new D1Repository(db)}),w=worker(l,db,{enabled:()=>true});const h=new HttpConversationClient('https://example.test/api/v1',async(u,i)=>w.fetch(new Request(u,i)));
 const c=value(await h.create({title:'Composed Worker'},{requestKey:'create'}));value(await h.send(c.id,{text:'Draft',expectedRevision:c.revision},{requestKey:'send'}));await w.scheduled();assert.equal(w.messages.length,1);
 let ack=0;const items=w.messages.splice(0);await w.queue({messages:items.concat(items).map(body=>({body,ack(){ack++;},retry(){throw Error('not expected');}}))});assert.equal(ack,2);assert.equal(l.provider.calls,1);assert.equal(value(await h.snapshot(c.id)).proposals[0].status,'pending');
 }finally{db.close();}
});
test('Worker drops malformed or unrecorded queue commands without granting authority',async()=>{
 const db=new SqliteAdapter();try{const l=await createLab({repository:new D1Repository(db)}),w=worker(l,db,{enabled:()=>true});let ack=0;await w.queue({messages:[{body:{id:'invented',actor:'admin'},ack(){ack++;},retry(){throw Error('unexpected');}}]});assert.equal(ack,1);assert.equal(l.provider.calls,0);}finally{db.close();}
});
test('SQLite-backed host saves effect receipts and reconciles after process-level storage reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'convos-host-'));let db=new SqliteAdapter(join(dir,'local.sqlite'));
 try{
  const host=new DemoHost(new SqliteHostStore(db)),l=await createLab({repository:new D1Repository(db),host});
  const c=value(await l.client.create({title:'Host persistence'},{requestKey:'create'}));value(await l.client.send(c.id,{text:'Keep this draft',expectedRevision:c.revision},{requestKey:'send'}));await l.pump();const p=value(await l.client.snapshot(c.id)).proposals[0];
  host.loseNextResponse=true;value(await l.client.decide(c.id,p.id,{decision:'approve',payloadHash:p.payloadHash},{requestKey:'approve'}));await l.pump();assert.equal(host.store.writes,1);
  db.close();db=new SqliteAdapter(join(dir,'local.sqlite'));const reopened=new DemoHost(new SqliteHostStore(db));const next=await createLab({repository:new D1Repository(db),host:reopened,clock:l.clock});l.clock.advance(31000);await next.repository.repair(new Date(l.clock.now()).toISOString());await next.pump();
  assert.equal(reopened.store.writes,1);assert.equal(value(await next.client.snapshot(c.id)).proposals[0].status,'applied');assert.match((await reopened.inspect(l.principal,c.id)).text,/Keep this draft/);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
