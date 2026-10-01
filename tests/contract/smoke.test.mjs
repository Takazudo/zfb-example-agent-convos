import test from 'node:test';
import assert from 'node:assert/strict';
import { createLab } from '../../build/packages/mock/src/lab.js';
import { D1Repository } from '../../build/workers/conversations/src/d1-repository.js';
import { SqliteAdapter } from '../../dev/sqlite.mjs';
const value = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
for (const adapter of ['memory', 'sqlite']) {
  test(`${adapter}: accepts, checkpoints, reviews, applies exactly once`, async t => {
    const db = adapter === 'sqlite' ? new SqliteAdapter() : null;
    if (db) t.after(() => db.close());
    const lab = await createLab(db ? { repository: new D1Repository(db) } : {});
    const c = value(await lab.client.create({ title: 'October release page' }, { requestKey: 'create-1' }));
    const sent = value(await lab.client.send(c.id, { text: 'Prepare an October release draft.', expectedRevision: c.revision }, { requestKey: 'send-1' }));
    const duplicate = value(await lab.client.send(c.id, { text: 'Prepare an October release draft.', expectedRevision: c.revision }, { requestKey: 'send-1' }));
    assert.deepEqual(duplicate, sent);
    await lab.pump();
    let snapshot = value(await lab.client.snapshot(c.id));
    assert.equal(snapshot.messages.length, 2); assert.equal(snapshot.runs[0].status, 'awaiting_approval');
    const p = snapshot.proposals[0];
    const approved = value(await lab.client.decide(c.id, p.id, { decision: 'approve', payloadHash: p.payloadHash }, { requestKey: 'approve-1' }));
    assert.equal(approved.status, 'approved');
    await lab.pump();
    snapshot = value(await lab.client.snapshot(c.id));
    assert.equal(snapshot.runs[0].status, 'completed'); assert.equal(snapshot.proposals[0].status, 'applied');
    assert.equal(lab.host.store.writes, 1);
    assert.equal(value(await lab.client.decide(c.id, p.id, { decision: 'approve', payloadHash: p.payloadHash }, { requestKey: 'approve-1' })).status, 'approved');
    await lab.pump(); assert.equal(lab.host.store.writes, 1);
    const events = value(await lab.client.events(c.id, 0));
    assert.equal(events.nextCursor, snapshot.throughEventSeq);
    assert.deepEqual(events.events.map(e => e.seq), Array.from({ length: events.events.length }, (_, i) => i + 1));
  });
}
