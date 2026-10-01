import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLab, DEMO_PRINCIPAL, TestClock } from '../../build/packages/mock/src/lab.js';
import { ConversationService } from '../../build/packages/core/src/service.js';
import { D1Repository } from '../../build/workers/conversations/src/d1-repository.js';
import { ExecutionRuntime, dispatchOutbox } from '../../build/workers/conversations/src/execution.js';
import { FakeProvider } from '../../build/packages/mock/src/fake-provider.js';
import { applyEvent, fromSnapshot } from '../../build/packages/core/src/event-projector.js';
import { sha256 } from '../../build/packages/core/src/validation.js';
import { SqliteAdapter } from '../../dev/sqlite.mjs';
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const code = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code); };
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
async function setup(t, adapter) {
  const db = adapter === 'sqlite' ? new SqliteAdapter() : null;
  if (db) t.after(() => db.close());
  return { ...await createLab(db ? { repository: new D1Repository(db) } : {}), db };
}
async function turn(lab, title = 'October release page') {
  const c = ok(await lab.client.create({ title }, { requestKey: lab.clock.id('create') }));
  const accepted = ok(await lab.client.send(c.id, { text: 'Prepare a draft, not a publication.', expectedRevision: c.revision }, { requestKey: lab.clock.id('send') }));
  return { c, accepted };
}
for (const adapter of ['memory', 'sqlite']) {
  const check = (name, fn) => test(`${adapter}: ${name}`, async t => fn(await setup(t, adapter), t));
  check('concurrent identical sends return one acceptance', async lab => {
    const c = ok(await lab.client.create({}, { requestKey: 'c' }));
    const invoke = () => lab.client.send(c.id, { text: 'draft', expectedRevision: 1 }, { requestKey: 'same' });
    const [a, b] = (await Promise.all([invoke(), invoke()])).map(ok);
    assert.deepEqual(a, b); const snap = ok(await lab.client.snapshot(c.id)); assert.equal(snap.messages.length, 1); assert.equal(snap.runs.length, 1);
  });
  check('concurrent distinct sends cannot admit two runs', async lab => {
    const c = ok(await lab.client.create({}, { requestKey: 'c' }));
    const r = await Promise.all(['a', 'b'].map(requestKey => lab.client.send(c.id, { text: requestKey, expectedRevision: 1 }, { requestKey })));
    assert.equal(r.filter(r => r.ok).length, 1); code(r.find(r => !r.ok), 'STALE_REVISION');
  });
  check('idempotency mismatch never mutates the accepted input', async lab => {
    const { c } = await turn(lab);
    const r = ok(await lab.client.snapshot(c.id));
    code(await lab.client.send(c.id, { text: 'first', expectedRevision: r.conversation.revision }, { requestKey: 'another' }), 'RUN_IN_PROGRESS');
    const a = ok(await lab.client.create({ title: 'one' }, { requestKey: 'reuse' }));
    code(await lab.client.create({ title: 'two' }, { requestKey: 'reuse' }), 'IDEMPOTENCY_CONFLICT');
    assert.equal(ok(await lab.client.snapshot(a.id)).conversation.title, 'one');
  });
  check('UTF-8 byte limits, invalid fields, hashes and numbers fail closed', async lab => {
    const c = ok(await lab.client.create({}, { requestKey: 'c' }));
    code(await lab.client.send(c.id, { text: '日'.repeat(5500), expectedRevision: 1 }, { requestKey: 'large' }), 'INVALID_REQUEST');
    code(await lab.client.send(c.id, { text: '\ud800', expectedRevision: 1 }, { requestKey: 'surrogate' }), 'INVALID_REQUEST');
    code(await lab.client.create({ title: 'x', ownerId: 'admin' }, { requestKey: 'actor-injection' }), 'INVALID_REQUEST');
    code(await lab.client.send(c.id, { text: 'hello', expectedRevision: 1.5 }, { requestKey: 'fraction' }), 'INVALID_REQUEST');
    code(await lab.client.create({ title: ' ' }, { requestKey: 'empty-title' }), 'INVALID_REQUEST');
    assert.equal(ok(await lab.client.snapshot(c.id)).messages.length, 0);
  });
  check('owner and workspace fences cover snapshots, events, context, export and writes', async lab => {
    const { c, accepted } = await turn(lab); await lab.pump();
    const p = ok(await lab.client.snapshot(c.id)).proposals[0];
    for (const changed of [{ actorId: 'someone-else' }, { workspaceId: 'another-workspace' }]) {
      const client = new ConversationService(lab.repository, { ...DEMO_PRINCIPAL, ...changed }, lab.host, lab.clock);
      assert.deepEqual(ok(await client.list({})).items, []);
      for (const r of [await client.snapshot(c.id), await client.events(c.id, 0), await client.export(c.id), await client.context(c.id, accepted.runId), await client.decide(c.id, p.id, { decision: 'approve', payloadHash: p.payloadHash }, { requestKey: 'other' })]) code(r, 'NOT_FOUND');
    }
  });
  check('run and proposal IDs cannot be moved under another conversation', async lab => {
    const { c, accepted } = await turn(lab); await lab.pump(); const p = ok(await lab.client.snapshot(c.id)).proposals[0];
    const another = ok(await lab.client.create({}, { requestKey: 'another' }));
    code(await lab.client.context(another.id, accepted.runId), 'NOT_FOUND');
    code(await lab.client.decide(another.id, p.id, { decision: 'approve', payloadHash: p.payloadHash }, { requestKey: 'cross' }), 'NOT_FOUND');
  });
  check('capabilities are checked before receipt replay', async lab => {
    ok(await lab.client.create({}, { requestKey: 'known' }));
    const readOnly = new ConversationService(lab.repository, { ...DEMO_PRINCIPAL, capabilities: ['conversations:read'] }, lab.host, lab.clock);
    code(await readOnly.create({}, { requestKey: 'known' }), 'FORBIDDEN');
    code(await readOnly.saveSkill('writing', { expectedHead: 1, body: 'Changed', note: '' }, { requestKey: 'skill' }), 'FORBIDDEN');
  });
  check('acceptance survives a missing queue send and is found by a new worker', async lab => {
    const { c } = await turn(lab);
    assert.equal(ok(await lab.client.snapshot(c.id)).runs[0].status, 'queued');
    const recovered = await createLab({ repository: lab.repository, host: lab.host, clock: lab.clock });
    await recovered.pump(); assert.equal(ok(await recovered.client.snapshot(c.id)).runs[0].status, 'awaiting_approval');
  });
  check('crash after queue delivery before outbox mark allows duplicate delivery, not duplicate generation', async lab => {
    const { c } = await turn(lab);
    const mark = lab.repository.markSent.bind(lab.repository); let once = true;
    lab.repository.markSent = async (...args) => { if (once) { once = false; throw new Error('Simulated crash'); } return mark(...args); };
    await assert.rejects(lab.dispatch()); await lab.dispatch(); assert.equal(lab.pending.length, 2);
    const [first, duplicate] = lab.pending.splice(0);
    assert.equal(await lab.runtime.deliver(first), true); assert.equal(await lab.runtime.deliver(duplicate), false);
    assert.equal(lab.provider.calls, 1); assert.equal(ok(await lab.client.snapshot(c.id)).messages.length, 2);
  });
  check('expired lease is reclaimed and a late old completion cannot overwrite it', async lab => {
    const { c } = await turn(lab); const entered = deferred(); const release = deferred();
    lab.provider.beforeFinish = async () => { entered.resolve(); await release.promise; };
    await lab.dispatch(); const item = lab.pending.shift(); const old = lab.runtime.deliver(item); await entered.promise;
    lab.provider.beforeFinish = null; lab.clock.advance(31_000);
    assert.equal(await lab.repository.repair(new Date(lab.clock.now()).toISOString()), 1);
    await lab.dispatch(); await lab.runtime.deliver(lab.pending.shift());
    const before = ok(await lab.client.snapshot(c.id)); release.resolve(); await old;
    const after = ok(await lab.client.snapshot(c.id)); assert.deepEqual(after, before);
    assert.equal(after.proposals.length, 1); assert.equal(after.messages.length, 2);
  });
  check('cancel during generation retains the accepted message and partial reply', async lab => {
    const { c, accepted } = await turn(lab); const entered = deferred(); const release = deferred();
    lab.provider.beforeFinish = async () => { entered.resolve(); await release.promise; };
    const running = lab.pump(); await entered.promise;
    assert.equal(ok(await lab.client.cancel(c.id, accepted.runId, { requestKey: 'cancel' })).status, 'cancel_requested');
    release.resolve(); await running; const snap = ok(await lab.client.snapshot(c.id));
    assert.equal(snap.runs[0].status, 'cancelled'); assert.equal(snap.messages.length, 2); assert.equal(snap.messages[1].state, 'partial'); assert.equal(snap.proposals.length, 0);
  });
  check('cancel queued run prevents provider execution', async lab => {
    const { c, accepted } = await turn(lab);
    ok(await lab.client.cancel(c.id, accepted.runId, { requestKey: 'cancel' })); await lab.pump();
    assert.equal(lab.provider.calls, 0); assert.equal(ok(await lab.client.snapshot(c.id)).runs[0].status, 'cancelled');
  });
  check('failed generation retry uses the exact original snapshot with no duplicate user turn', async lab => {
    lab.provider.mode = 'fail'; const { c, accepted } = await turn(lab); await lab.pump();
    const old = ok(await lab.client.context(c.id, accepted.runId));
    ok(await lab.client.saveSkill('writing', { expectedHead: 1, body: 'Newer instructions', note: 'update' }, { requestKey: 'edit' }));
    lab.provider.mode = 'review'; const retry = ok(await lab.client.retry(c.id, accepted.runId, { requestKey: 'retry' }));
    assert.notEqual(retry.runId, accepted.runId); assert.equal(retry.messageId, accepted.messageId);
    assert.deepEqual(ok(await lab.client.context(c.id, retry.runId)), old); await lab.pump();
    assert.equal(ok(await lab.client.snapshot(c.id)).messages.filter(m => m.role === 'user').length, 1);
  });
  check('skill restore appends a revision and preserves hashes and accepted-run pins', async lab => {
    const { c, accepted } = await turn(lab); const original = ok(await lab.client.skillHistory('writing')).items[0];
    const second = ok(await lab.client.saveSkill('writing', { expectedHead: 1, body: 'Changed body', note: 'edit' }, { requestKey: 'edit' }));
    assert.equal(second.bodyHash, await sha256(second.body));
    const third = ok(await lab.client.restoreSkill('writing', { expectedHead: 2, sourceVersion: 1 }, { requestKey: 'restore' }));
    assert.equal(third.version, 3); assert.equal(third.restoredFromVersion, 1); assert.equal(third.bodyHash, original.bodyHash);
    const pins = ok(await lab.client.context(c.id, accepted.runId)).skillPins; assert.equal(pins.find(p => p.skillId === 'writing').version, 1);
    code(await lab.client.saveSkill('writing', { expectedHead: 1, body: 'Stale', note: '' }, { requestKey: 'stale-skill' }), 'STALE_REVISION');
  });
  check('two simultaneous skill edits cannot overwrite the same head', async lab => {
    const results = await Promise.all(['a', 'b'].map(body => lab.client.saveSkill('writing', { expectedHead: 1, body, note: '' }, { requestKey: body })));
    assert.equal(results.filter(r => r.ok).length, 1); code(results.find(r => !r.ok), 'STALE_REVISION');
    assert.equal(ok(await lab.client.skillHistory('writing')).items.length, 2);
  });
  check('wrong proposal hash and repeat approval under another key are rejected', async lab => {
    const { c } = await turn(lab); await lab.pump(); const p = ok(await lab.client.snapshot(c.id)).proposals[0];
    code(await lab.client.decide(c.id, p.id, { decision: 'approve', payloadHash: '0'.repeat(64) }, { requestKey: 'wrong' }), 'STALE_PROPOSAL');
    ok(await lab.client.decide(c.id, p.id, { decision: 'approve', payloadHash: p.payloadHash }, { requestKey: 'right' }));
    code(await lab.client.decide(c.id, p.id, { decision: 'approve', payloadHash: p.payloadHash }, { requestKey: 'other-key' }), 'PROPOSAL_NOT_PENDING');
  });
  check('stale host approval cannot overwrite and refresh takes new context', async lab => {
    const { c, accepted } = await turn(lab); await lab.pump(); const p = ok(await lab.client.snapshot(c.id)).proposals[0];
    await lab.host.externalChange(lab.principal);
    ok(await lab.client.decide(c.id, p.id, { decision: 'approve', payloadHash: p.payloadHash }, { requestKey: 'approve' })); await lab.pump();
    let snap = ok(await lab.client.snapshot(c.id)); assert.equal(snap.proposals[0].status, 'stale'); assert.equal(lab.host.store.writes, 0);
    const refresh = ok(await lab.client.refreshProposal(c.id, p.id, { requestKey: 'refresh' }));
    assert.notEqual(ok(await lab.client.context(c.id, refresh.runId)).snapshotId, ok(await lab.client.context(c.id, accepted.runId)).snapshotId);
    await lab.pump(); snap = ok(await lab.client.snapshot(c.id));
    const next = snap.proposals.find(x => x.runId === refresh.runId); assert.equal(next.baseRevision, '8');
    assert.equal(snap.messages.filter(m => m.role === 'user').length, 1);
    ok(await lab.client.decide(c.id, next.id, { decision: 'approve', payloadHash: next.payloadHash }, { requestKey: 'approve-new' })); await lab.pump(); assert.equal(lab.host.store.writes, 1);
  });
  check('lost apply response blocks new work, then reconciliation recovers one host effect', async lab => {
    const { c, accepted } = await turn(lab); await lab.pump(); const p = ok(await lab.client.snapshot(c.id)).proposals[0];
    lab.host.loseNextResponse = true; lab.host.reconciliationUnavailable = true;
    ok(await lab.client.decide(c.id, p.id, { decision: 'approve', payloadHash: p.payloadHash }, { requestKey: 'approve' })); await lab.pump();
    let snap = ok(await lab.client.snapshot(c.id)); assert.equal(snap.runs[0].status, 'needs_reconciliation'); assert.equal(lab.host.store.writes, 1);
    code(await lab.client.cancel(c.id, accepted.runId, { requestKey: 'cancel-unknown' }), 'TOOL_RESULT_UNKNOWN');
    code(await lab.client.send(c.id, { text: 'new', expectedRevision: snap.conversation.revision }, { requestKey: 'new' }), 'RUN_IN_PROGRESS');
    code(await lab.client.retry(c.id, accepted.runId, { requestKey: 'retry-unknown' }), 'INVALID_REQUEST');
    lab.host.reconciliationUnavailable = false; lab.clock.advance(31_000); await lab.repository.repair(new Date(lab.clock.now()).toISOString()); await lab.pump();
    snap = ok(await lab.client.snapshot(c.id)); assert.equal(snap.runs[0].status, 'completed'); assert.equal(snap.proposals[0].status, 'applied'); assert.equal(lab.host.store.writes, 1);
  });
  check('revoked host permission is checked again before apply', async lab => {
    const { c } = await turn(lab); await lab.pump(); const p = ok(await lab.client.snapshot(c.id)).proposals[0];
    ok(await lab.client.decide(c.id, p.id, { decision: 'approve', payloadHash: p.payloadHash }, { requestKey: 'approve' })); lab.host.deny = true; await lab.pump();
    assert.equal(lab.host.store.writes, 0); assert.equal(ok(await lab.client.snapshot(c.id)).runs[0].status, 'failed');
  });
  check('archive is reversible and not allowed to hide unresolved work', async lab => {
    const { c, accepted } = await turn(lab); let snap = ok(await lab.client.snapshot(c.id));
    code(await lab.client.update(c.id, { expectedRevision: snap.conversation.revision, archived: true }, { requestKey: 'archive-active' }), 'RUN_IN_PROGRESS');
    ok(await lab.client.cancel(c.id, accepted.runId, { requestKey: 'cancel' })); snap = ok(await lab.client.snapshot(c.id));
    const archived = ok(await lab.client.update(c.id, { expectedRevision: snap.conversation.revision, archived: true }, { requestKey: 'archive' }));
    assert.equal(ok(await lab.client.list({})).items.length, 0); assert.equal(ok(await lab.client.list({ archived: true })).items.length, 1);
    code(await lab.client.send(c.id, { text: 'not now', expectedRevision: archived.revision }, { requestKey: 'archived-send' }), 'CONVERSATION_ARCHIVED');
    ok(await lab.client.update(c.id, { expectedRevision: archived.revision, archived: false }, { requestKey: 'restore' }));
    assert.equal(ok(await lab.client.export(c.id)).snapshot.messages.length, 1);
  });
  check('event pages replay to the consistent snapshot and reject future cursors', async lab => {
    const c = ok(await lab.client.create({}, { requestKey: 'c' })); const baseline = ok(await lab.client.snapshot(c.id));
    lab.provider.mode = 'read-only';
    for (let i = 0; i < 12; i++) {
      const s = ok(await lab.client.snapshot(c.id)); ok(await lab.client.send(c.id, { text: `Message ${i}`, expectedRevision: s.conversation.revision }, { requestKey: `m${i}` })); await lab.pump();
    }
    let projection = fromSnapshot(baseline); let pages = 0;
    while (true) {
      const page = ok(await lab.client.events(c.id, projection.cursor)); pages++;
      for (const e of page.events) projection = applyEvent(projection, e);
      assert.equal(projection.cursor, page.nextCursor); if (!page.hasMore) break;
    }
    assert.ok(pages >= 2); const snapshot = ok(await lab.client.snapshot(c.id));
    assert.deepEqual(projection.conversation, snapshot.conversation); assert.deepEqual(Object.values(projection.messages), snapshot.messages);
    code(await lab.client.events(c.id, projection.cursor + 1), 'CURSOR_INVALID');
  });
  check('history is paginated while export includes every retained message', async lab => {
    const c = ok(await lab.client.create({}, { requestKey: 'c' })); lab.provider.mode = 'read-only';
    for (let i = 0; i < 27; i++) { const s = ok(await lab.client.snapshot(c.id)); ok(await lab.client.send(c.id, { text: `Message ${i}`, expectedRevision: s.conversation.revision }, { requestKey: `m${i}` })); await lab.pump(); }
    const snap = ok(await lab.client.snapshot(c.id)); assert.equal(snap.messages.length, 50); assert.ok(snap.nextMessagePage);
    const older = ok(await lab.client.history(c.id, snap.nextMessagePage)); assert.equal(older.messages.length, 4); assert.equal(older.nextCursor, null);
    assert.equal(ok(await lab.client.export(c.id)).snapshot.messages.length, 54);
  });
}
test('SQLite: failed assertion rolls back preceding writes and leaves no assertion row', async t => {
  const db = new SqliteAdapter(); t.after(() => db.close());
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO scopes(id,tenant_id,application_id,workspace_id) VALUES('s','t','a','w')"),
    db.prepare("INSERT INTO transaction_assertions(id,ok) VALUES('must-fail',0)"),
  ]));
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM scopes').get().n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM transaction_assertions').get().n, 0);
});
test('SQLite: database close/reopen preserves accepted intent and skill versions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'convos-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'db.sqlite'); let db = new SqliteAdapter(file); const clock = new TestClock();
  let lab = await createLab({ repository: new D1Repository(db), clock }); const { c } = await turn(lab);
  ok(await lab.client.saveSkill('writing', { expectedHead: 1, body: 'Retained new revision', note: '' }, { requestKey: 'edit' }));
  db.close(); db = new SqliteAdapter(file); t.after(() => db.close());
  lab = await createLab({ repository: new D1Repository(db), clock }); await lab.pump();
  assert.equal(ok(await lab.client.snapshot(c.id)).runs[0].status, 'awaiting_approval'); assert.equal(ok(await lab.client.skillHistory('writing')).items.length, 2);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM transaction_assertions').get().n, 0);
});
