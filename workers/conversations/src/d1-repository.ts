import type { Conversation, ConversationEvent, Message, Run, Proposal, SkillRevision } from '../../../packages/core/src/domain.js';
import type { Claim, Manifest, Receipt, Repository, Scope, Skill, StoredConversation, WorkItem, Write } from '../../../packages/core/src/repository.js';
import { ACTIVE } from '../../../packages/core/src/service.js';
import { canonical, ConflictError, clone } from '../../../packages/core/src/validation.js';
/** Structural subset of Cloudflare D1. Production must supply a real binding.
 * The offline adapter in dev/ uses Node SQLite and is explicitly NOT Miniflare. */
export type SqlValue = string | number | null;
export interface SqlResult<T = Record<string, unknown>> {
    results: T[];
    success?: boolean;
    meta?: {
        changes?: number;
    };
}
export interface SqlStatement {
    bind(...values: SqlValue[]): SqlStatement;
    all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
}
export interface D1Port {
    prepare(sql: string): SqlStatement;
    batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<Array<SqlResult<T>>>;
}
type Row = Record<string, string | number | null>;
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const s = (value: unknown): string => String(value);
const n = (value: unknown): number => Number(value);
const activeSql = "('queued','running','awaiting_approval','applying','cancel_requested','needs_reconciliation')";
function conversation(row: Row, runs: Run[]): Conversation {
    const active = runs.find(r => ACTIVE.has(r.status));
    return { id: s(row.id), title: s(row.title), archived: row.archived === 1, revision: n(row.revision), lastEventSeq: n(row.last_seq), createdAt: s(row.created_at), updatedAt: s(row.updated_at), activeRun: active ? { id: active.id, status: active.status } : null };
}
function message(row: Row): Message {
    return { id: s(row.id), conversationId: s(row.conversation_id), runId: row.run_id as string | null, role: row.role as Message['role'], parts: parse(row.parts_json), state: row.state as Message['state'], createdSeq: n(row.created_seq), createdAt: s(row.created_at) };
}
function proposal(row: Row): Proposal {
    return { id: s(row.id), conversationId: s(row.conversation_id), runId: s(row.run_id), status: row.status as Proposal['status'], payloadHash: s(row.payload_hash), action: parse(row.action_json), baseRevision: row.base_revision as string | null, display: parse(row.display_json), createdAt: s(row.created_at) };
}
function version(row: Row): SkillRevision {
    return { skillId: s(row.skill_id), version: n(row.version), body: s(row.body), bodyHash: s(row.body_hash), note: s(row.note), restoredFromVersion: row.restored_from_version === null ? null : n(row.restored_from_version), createdAt: s(row.created_at) };
}
export class D1Repository implements Repository {
    constructor(readonly db: D1Port) { }
    private q(sql: string, ...values: SqlValue[]) { return this.db.prepare(sql).bind(...values); }
    private async rows(sql: string, ...values: SqlValue[]): Promise<Row[]> { return (await this.q(sql, ...values).all<Row>()).results; }
    private async batch(statements: SqlStatement[]) {
        const results = await this.db.batch<Row>(statements);
        if (results.some(r => r.success === false))
            throw new Error('Database batch did not succeed');
        return results;
    }
    async ensureScope(scope: Scope) {
        await this.batch([this.q('INSERT OR IGNORE INTO scopes(id,tenant_id,application_id,workspace_id) VALUES(?,?,?,?)', scope.id, scope.tenantId, scope.applicationId, scope.workspaceId)]);
    }
    async get(scopeId: string, actorId: string, conversationId: string): Promise<StoredConversation | null> {
        const guard = 'scope_id=? AND conversation_id=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.scope_id=? AND c.id=? AND c.owner_id=?)';
        const args: SqlValue[] = [scopeId, conversationId, scopeId, conversationId, actorId];
        const results = await this.batch([
            this.q('SELECT * FROM conversations WHERE scope_id=? AND id=? AND owner_id=?', scopeId, conversationId, actorId),
            this.q(`SELECT * FROM messages WHERE ${guard} ORDER BY created_seq,id`, ...args),
            this.q(`SELECT * FROM runs WHERE ${guard} ORDER BY created_at,id`, ...args),
            this.q(`SELECT * FROM proposals WHERE ${guard} ORDER BY created_at,id`, ...args),
            this.q(`SELECT * FROM context_snapshots WHERE ${guard}`, ...args),
        ]);
        const row = results[0]!.results[0];
        if (!row)
            return null;
        const manifests = results[4]!.results.map(r => parse<Manifest>(r.manifest_json));
        const claims: Record<string, Claim> = {};
        const runs: Run[] = results[2]!.results.map(r => {
            if (r.claim_token !== null && r.claim_expires_at !== null)
                claims[s(r.id)] = { token: s(r.claim_token), generation: n(r.generation), expiresAt: s(r.claim_expires_at), attempt: n(r.attempt) };
            const manifest = manifests.find(m => m.snapshotId === r.context_snapshot_id);
            if (!manifest)
                throw new Error('Stored run has no context');
            return { id: s(r.id), conversationId: s(r.conversation_id), inputMessageId: s(r.input_message_id), contextSnapshotId: s(r.context_snapshot_id), status: r.status as Run['status'], revision: n(r.revision), retryOfRunId: r.retry_of_run_id as string | null, refreshOfProposalId: r.refresh_of_proposal_id as string | null, skillPins: clone(manifest.skillPins), createdAt: s(r.created_at), updatedAt: s(r.updated_at), outcome: r.outcome as Run['outcome'], error: r.error_json === null ? null : parse(r.error_json) };
        });
        return { scopeId, ownerId: actorId, conversation: conversation(row, runs), messages: results[1]!.results.map(message), runs, proposals: results[3]!.results.map(proposal), manifests, claims };
    }
    async list(scopeId: string, actorId: string): Promise<Conversation[]> {
        const rows = await this.rows(`SELECT c.*,
      (SELECT r.id FROM runs r WHERE r.scope_id=c.scope_id AND r.conversation_id=c.id AND r.status IN ${activeSql}) AS active_id,
      (SELECT r.status FROM runs r WHERE r.scope_id=c.scope_id AND r.conversation_id=c.id AND r.status IN ${activeSql}) AS active_status
      FROM conversations c WHERE c.scope_id=? AND c.owner_id=? ORDER BY c.updated_at DESC,c.id DESC`, scopeId, actorId);
        return rows.map(r => ({ ...conversation(r, []), activeRun: r.active_id === null ? null : { id: s(r.active_id), status: r.active_status as Run['status'] } }));
    }
    async receipt(scopeId: string, actorId: string, operation: string, key: string): Promise<Receipt | null> {
        const row = (await this.rows('SELECT * FROM commands WHERE scope_id=? AND actor_id=? AND operation=? AND request_key=?', scopeId, actorId, operation, key))[0];
        return row ? { operation, key, payloadHash: s(row.payload_hash), status: n(row.response_status), value: parse(row.response_json), at: s(row.created_at) } : null;
    }
    private receiptStatement(scopeId: string, actorId: string, r: Receipt) {
        return this.q('INSERT INTO commands(scope_id,actor_id,operation,request_key,payload_hash,response_status,response_json,created_at) VALUES(?,?,?,?,?,?,?,?)', scopeId, actorId, r.operation, r.key, r.payloadHash, r.status, JSON.stringify(r.value), r.at);
    }
    private assertion(id: string, condition: string, args: SqlValue[]) {
        return this.q(`INSERT INTO transaction_assertions(id,ok) SELECT ?,CASE WHEN (${condition}) THEN 1 ELSE 0 END`, id, ...args);
    }
    async commit(w: Write) {
        const before = await this.get(w.scope.id, w.actorId, w.state.conversation.id);
        if ((before?.conversation.revision ?? null) !== w.beforeRevision)
            throw new ConflictError();
        const sid = w.scope.id;
        const c = w.state.conversation;
        const assertionId = crypto.randomUUID();
        const statements: SqlStatement[] = [];
        if (w.beforeRevision === null) {
            statements.push(this.assertion(assertionId, 'NOT EXISTS(SELECT 1 FROM conversations WHERE scope_id=? AND id=?)', [sid, c.id]));
        }
        else {
            statements.push(this.assertion(assertionId, 'EXISTS(SELECT 1 FROM conversations WHERE scope_id=? AND id=? AND owner_id=? AND revision=? AND last_seq=?)', [sid, c.id, w.actorId, w.beforeRevision, before!.conversation.lastEventSeq]));
        }
        if (w.claimFence) {
            const f = w.claimFence;
            statements.push(this.assertion(`${assertionId}-claim`, 'EXISTS(SELECT 1 FROM runs WHERE scope_id=? AND conversation_id=? AND id=? AND claim_token=? AND generation=? AND claim_expires_at>?)', [sid, c.id, f.runId, f.token, f.generation, f.now]));
        }
        if (w.beforeRevision === null) {
            statements.push(this.q('INSERT INTO conversations(scope_id,id,owner_id,title,archived,revision,last_seq,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', sid, c.id, w.actorId, c.title, +c.archived, c.revision, c.lastEventSeq, c.createdAt, c.updatedAt));
        }
        else {
            statements.push(this.q('UPDATE conversations SET title=?,archived=?,revision=?,last_seq=?,updated_at=? WHERE scope_id=? AND id=?', c.title, +c.archived, c.revision, c.lastEventSeq, c.updatedAt, sid, c.id));
        }
        const changed = <T>(old: T | undefined, next: T) => !old || canonical(old) !== canonical(next);
        for (const m of w.state.messages) {
            if (!changed(before?.messages.find(x => x.id === m.id), m))
                continue;
            statements.push(this.q(`INSERT INTO messages(scope_id,id,conversation_id,run_id,role,parts_json,state,created_seq,created_at) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(scope_id,id) DO UPDATE SET parts_json=excluded.parts_json,state=excluded.state`, sid, m.id, c.id, m.runId, m.role, JSON.stringify(m.parts), m.state, m.createdSeq, m.createdAt));
        }
        for (const m of w.state.manifests) {
            if (before?.manifests.some(x => x.snapshotId === m.snapshotId))
                continue;
            statements.push(this.q('INSERT INTO context_snapshots(scope_id,id,conversation_id,through_seq,manifest_json,manifest_hash,created_at) VALUES(?,?,?,?,?,?,?)', sid, m.snapshotId, c.id, m.throughEventSeq, JSON.stringify(m), m.hash, c.updatedAt));
        }
        for (const r of w.state.runs) {
            const old = before?.runs.find(x => x.id === r.id);
            const claim = w.state.claims[r.id];
            const oldClaim = before?.claims[r.id];
            if (!changed(old, r) && canonical(oldClaim ?? null) === canonical(claim ?? null))
                continue;
            statements.push(this.q(`INSERT INTO runs(scope_id,id,conversation_id,input_message_id,context_snapshot_id,status,revision,retry_of_run_id,refresh_of_proposal_id,claim_token,claim_expires_at,generation,attempt,outcome,error_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope_id,id) DO UPDATE SET status=excluded.status,revision=excluded.revision,claim_token=excluded.claim_token,claim_expires_at=excluded.claim_expires_at,generation=excluded.generation,attempt=excluded.attempt,outcome=excluded.outcome,error_json=excluded.error_json,updated_at=excluded.updated_at`, sid, r.id, c.id, r.inputMessageId, r.contextSnapshotId, r.status, r.revision, r.retryOfRunId, r.refreshOfProposalId, claim?.token ?? null, claim?.expiresAt ?? null, claim?.generation ?? oldClaim?.generation ?? 0, claim?.attempt ?? oldClaim?.attempt ?? 0, r.outcome, r.error === null ? null : JSON.stringify(r.error), r.createdAt, r.updatedAt));
            if (!old)
                for (const pin of r.skillPins)
                    statements.push(this.q('INSERT INTO run_skill_pins(scope_id,run_id,skill_id,version) VALUES(?,?,?,?)', sid, r.id, pin.skillId, pin.version));
        }
        for (const p of w.state.proposals) {
            const old = before?.proposals.find(x => x.id === p.id);
            if (!changed(old, p))
                continue;
            if (!old)
                statements.push(this.q('INSERT INTO proposals(scope_id,id,conversation_id,run_id,status,payload_hash,action_json,base_revision,display_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', sid, p.id, c.id, p.runId, p.status, p.payloadHash, JSON.stringify(p.action), p.baseRevision, JSON.stringify(p.display), p.createdAt));
            else
                statements.push(this.q('UPDATE proposals SET status=?,decision_by=CASE WHEN ? IN (\'approved\',\'rejected\') THEN COALESCE(decision_by,?) ELSE decision_by END,decided_at=CASE WHEN ? IN (\'approved\',\'rejected\') THEN COALESCE(decided_at,?) ELSE decided_at END WHERE scope_id=? AND id=?', p.status, p.status, w.actorId, p.status, c.updatedAt, sid, p.id));
        }
        for (const e of w.events) {
            statements.push(this.q('INSERT INTO events(scope_id,conversation_id,seq,schema_version,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?,?)', sid, c.id, e.seq, e.schemaVersion, e.type, JSON.stringify(e.payload), e.at));
            if (e.type === 'tool.receipt')
                statements.push(this.q(`INSERT INTO tool_effects(scope_id,effect_key,proposal_id,status,receipt_json,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(scope_id,effect_key) DO UPDATE SET status=excluded.status,receipt_json=excluded.receipt_json,updated_at=excluded.updated_at`, sid, e.payload.effectKey, e.payload.proposalId, e.payload.outcome === 'succeeded' ? 'succeeded' : e.payload.outcome === 'failed' ? 'failed' : 'unknown', JSON.stringify(e.payload), e.at));
        }
        for (const j of w.outbox)
            statements.push(this.q('INSERT INTO outbox(scope_id,id,run_id,kind,status,attempt,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?)', sid, j.id, j.runId, j.kind, j.status, j.attempt, j.nextAttemptAt, j.createdAt));
        if (w.receipt)
            statements.push(this.receiptStatement(sid, w.actorId, w.receipt));
        statements.push(this.q('DELETE FROM transaction_assertions WHERE id=? OR id=?', assertionId, `${assertionId}-claim`));
        try {
            await this.batch(statements);
        }
        catch (error) {
            const latest = await this.get(sid, w.actorId, c.id);
            const fence = w.claimFence;
            const latestClaim = fence ? latest?.claims[fence.runId] : null;
            if ((latest?.conversation.revision ?? null) !== w.beforeRevision || (fence && (!latestClaim || latestClaim.token !== fence.token || latestClaim.generation !== fence.generation || latestClaim.expiresAt <= fence.now)))
                throw new ConflictError();
            if (w.receipt && await this.receipt(sid, w.actorId, w.receipt.operation, w.receipt.key))
                throw new ConflictError();
            throw error;
        }
    }
    async events(scopeId: string, actorId: string, conversationId: string, after: number) {
        if (!(await this.rows('SELECT id FROM conversations WHERE scope_id=? AND id=? AND owner_id=?', scopeId, conversationId, actorId)).length)
            return null;
        const rows = await this.rows('SELECT * FROM events WHERE scope_id=? AND conversation_id=? AND seq>? ORDER BY seq LIMIT 101', scopeId, conversationId, after);
        return rows.map(r => ({ schemaVersion: 1, conversationId, seq: n(r.seq), at: s(r.created_at), type: r.event_type, payload: parse(r.payload_json) }) as ConversationEvent);
    }
    async skills(scopeId: string): Promise<Skill[]> {
        return (await this.rows('SELECT * FROM skills WHERE scope_id=? AND head_version>0 ORDER BY id', scopeId)).map(r => ({ id: s(r.id), name: s(r.name), description: s(r.description), headVersion: n(r.head_version) }));
    }
    async versions(scopeId: string, skillId: string) { return (await this.rows('SELECT * FROM skill_revisions WHERE scope_id=? AND skill_id=? ORDER BY version DESC', scopeId, skillId)).map(version); }
    async appendSkill(i: Parameters<Repository['appendSkill']>[0]) {
        const a = crypto.randomUUID();
        const statements: SqlStatement[] = [];
        statements.push(this.assertion(a, 'COALESCE((SELECT head_version FROM skills WHERE scope_id=? AND id=?),0)=?', [i.scope.id, i.skill.id, i.expectedHead]));
        if (i.expectedHead === 0)
            statements.push(this.q('INSERT INTO skills(scope_id,id,name,description,head_version) VALUES(?,?,?,?,0)', i.scope.id, i.skill.id, i.skill.name, i.skill.description));
        const v = i.revision;
        statements.push(this.q('INSERT INTO skill_revisions(scope_id,skill_id,version,body,body_hash,note,author_id,restored_from_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)', i.scope.id, i.skill.id, v.version, v.body, v.bodyHash, v.note, i.actorId, v.restoredFromVersion, v.createdAt));
        statements.push(this.q('UPDATE skills SET head_version=? WHERE scope_id=? AND id=?', v.version, i.scope.id, i.skill.id));
        if (i.receipt)
            statements.push(this.receiptStatement(i.scope.id, i.actorId, i.receipt));
        statements.push(this.q('DELETE FROM transaction_assertions WHERE id=?', a));
        try {
            await this.batch(statements);
        }
        catch (error) {
            const head = (await this.skills(i.scope.id)).find(s => s.id === i.skill.id)?.headVersion ?? 0;
            if (head !== i.expectedHead || (i.receipt && await this.receipt(i.scope.id, i.actorId, i.receipt.operation, i.receipt.key)))
                throw new ConflictError();
            throw error;
        }
    }
    async work(now: string): Promise<WorkItem[]> {
        const rows = await this.rows('SELECT o.*,r.conversation_id FROM outbox o JOIN runs r ON r.scope_id=o.scope_id AND r.id=o.run_id WHERE o.status=\'pending\' AND o.next_attempt_at<=? ORDER BY o.created_at,o.id LIMIT 20', now);
        return rows.map(r => ({ id: s(r.id), scopeId: s(r.scope_id), conversationId: s(r.conversation_id), runId: s(r.run_id), kind: r.kind as WorkItem['kind'], status: r.status as WorkItem['status'], attempt: n(r.attempt), nextAttemptAt: s(r.next_attempt_at), createdAt: s(r.created_at) }));
    }
    async markSent(item: WorkItem, nextAttemptAt: string) {
        await this.batch([this.q("UPDATE outbox SET status='sent',attempt=attempt+1,next_attempt_at=? WHERE scope_id=? AND id=? AND status='pending'", nextAttemptAt, item.scopeId, item.id)]);
    }
    async repair(now: string): Promise<number> {
        const result = await this.batch([this.q(`UPDATE outbox SET status='pending',next_attempt_at=? WHERE status='sent' AND next_attempt_at<=? AND EXISTS(
      SELECT 1 FROM runs r WHERE r.scope_id=outbox.scope_id AND r.id=outbox.run_id AND (r.claim_token IS NULL OR r.claim_expires_at<=?) AND
      ((outbox.kind='generate' AND r.status IN ('queued','running','cancel_requested')) OR (outbox.kind='apply' AND r.status='applying') OR (outbox.kind='reconcile' AND r.status='needs_reconciliation')))`, now, now, now)]);
        return result[0]?.meta?.changes ?? 0;
    }
    async resolveWork(item: WorkItem) {
        const row = (await this.rows('SELECT c.owner_id,s.* FROM outbox o JOIN runs r ON r.scope_id=o.scope_id AND r.id=o.run_id JOIN conversations c ON c.scope_id=r.scope_id AND c.id=r.conversation_id JOIN scopes s ON s.id=c.scope_id WHERE o.scope_id=? AND o.id=? AND o.run_id=? AND r.conversation_id=? AND o.kind=?', item.scopeId, item.id, item.runId, item.conversationId, item.kind))[0];
        if (!row)
            return null;
        const ownerId = s(row.owner_id);
        const state = await this.get(item.scopeId, ownerId, item.conversationId);
        if (!state)
            return null;
        return { state, ownerId, scope: { id: s(row.id), tenantId: s(row.tenant_id), applicationId: s(row.application_id), workspaceId: s(row.workspace_id) } };
    }
}
