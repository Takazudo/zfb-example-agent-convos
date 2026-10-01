import type { Conversation, ConversationEvent, SkillRevision } from '../../core/src/domain.js';
import type { Repository, Scope, StoredConversation, Receipt, Skill, WorkItem, Write } from '../../core/src/repository.js';
import { clone, ConflictError } from '../../core/src/validation.js';
import { ACTIVE } from '../../core/src/service.js';
const key = (...parts: string[]) => JSON.stringify(parts);
/** Transactional in-memory adapter, deliberately not a durable storage claim. */
export class MemoryRepository implements Repository {
    private scopes = new Map<string, Scope>();
    private states = new Map<string, StoredConversation>();
    private logs = new Map<string, ConversationEvent[]>();
    private receipts = new Map<string, Receipt>();
    private skillHeads = new Map<string, Skill>();
    private skillVersions = new Map<string, SkillRevision[]>();
    private jobs = new Map<string, WorkItem>();
    async ensureScope(scope: Scope) { this.scopes.set(scope.id, clone(scope)); }
    async get(scopeId: string, actorId: string, conversationId: string): Promise<StoredConversation | null> {
        const s = this.states.get(key(scopeId, conversationId));
        return s?.ownerId === actorId ? clone(s) : null;
    }
    async list(scopeId: string, actorId: string): Promise<Conversation[]> {
        return clone([...this.states.values()].filter(s => s.scopeId === scopeId && s.ownerId === actorId).map(s => s.conversation));
    }
    async receipt(scopeId: string, actorId: string, operation: string, requestKey: string) {
        return clone(this.receipts.get(key(scopeId, actorId, operation, requestKey)) ?? null);
    }
    async commit(w: Write) {
        const k = key(w.scope.id, w.state.conversation.id);
        const prev = this.states.get(k);
        if (w.beforeRevision === null ? prev !== undefined : !prev || prev.ownerId !== w.actorId || prev.conversation.revision !== w.beforeRevision)
            throw new ConflictError();
        const receiptKey = w.receipt ? key(w.scope.id, w.actorId, w.receipt.operation, w.receipt.key) : null;
        if (receiptKey && this.receipts.has(receiptKey))
            throw new ConflictError();
        if (w.claimFence) {
            const f = w.claimFence;
            const c = prev?.claims[f.runId];
            if (!c || c.token !== f.token || c.generation !== f.generation || c.expiresAt <= f.now)
                throw new ConflictError();
        }
        if (w.state.runs.filter(r => ACTIVE.has(r.status)).length > 1)
            throw new Error('ONE_ACTIVE_RUN');
        let expected = (prev?.conversation.lastEventSeq ?? 0) + 1;
        for (const event of w.events)
            if (event.conversationId !== w.state.conversation.id || event.seq !== expected++)
                throw new Error('INVALID_EVENT_APPEND');
        if (w.state.conversation.lastEventSeq !== expected - 1)
            throw new Error('CURSOR_NOT_AT_CUT');
        // Validate the full write before changing any of the maps.
        const state = clone(w.state);
        const log = clone([...(this.logs.get(k) ?? []), ...w.events]);
        this.states.set(k, state);
        this.logs.set(k, log);
        if (receiptKey && w.receipt)
            this.receipts.set(receiptKey, clone(w.receipt));
        for (const job of w.outbox)
            this.jobs.set(key(job.scopeId, job.id), clone(job));
    }
    async events(scopeId: string, actorId: string, conversationId: string, after: number) {
        if (!(await this.get(scopeId, actorId, conversationId)))
            return null;
        return clone((this.logs.get(key(scopeId, conversationId)) ?? []).filter(e => e.seq > after));
    }
    async skills(scopeId: string) {
        const rows: Skill[] = [];
        for (const [k, value] of this.skillHeads)
            if (JSON.parse(k)[0] === scopeId)
                rows.push(value);
        return clone(rows.sort((a, b) => a.id.localeCompare(b.id)));
    }
    async versions(scopeId: string, skillId: string) { return clone(this.skillVersions.get(key(scopeId, skillId)) ?? []); }
    async appendSkill(i: Parameters<Repository['appendSkill']>[0]) {
        const k = key(i.scope.id, i.skill.id);
        const current = this.skillHeads.get(k);
        if ((current?.headVersion ?? 0) !== i.expectedHead || i.revision.version !== i.expectedHead + 1)
            throw new ConflictError();
        const rk = i.receipt ? key(i.scope.id, i.actorId, i.receipt.operation, i.receipt.key) : null;
        if (rk && this.receipts.has(rk))
            throw new ConflictError();
        if (i.revision.restoredFromVersion !== null && !(this.skillVersions.get(k) ?? []).some(v => v.version === i.revision.restoredFromVersion))
            throw new Error('RESTORE_SOURCE_MISSING');
        this.skillVersions.set(k, clone([...(this.skillVersions.get(k) ?? []), i.revision]));
        this.skillHeads.set(k, { ...clone(i.skill), headVersion: i.revision.version });
        if (rk && i.receipt)
            this.receipts.set(rk, clone(i.receipt));
    }
    async work(now: string) { return clone([...this.jobs.values()].filter(j => j.status === 'pending' && j.nextAttemptAt <= now).slice(0, 20)); }
    async markSent(item: WorkItem, nextAttemptAt: string) {
        const j = this.jobs.get(key(item.scopeId, item.id));
        if (j?.status === 'pending')
            this.jobs.set(key(item.scopeId, item.id), { ...j, status: 'sent', attempt: j.attempt + 1, nextAttemptAt });
    }
    async repair(now: string) {
        let count = 0;
        for (const [k, j] of this.jobs) {
            const s = this.states.get(key(j.scopeId, j.conversationId));
            const run = s?.runs.find(r => r.id === j.runId);
            const c = s?.claims[j.runId];
            const relevant = j.kind === 'generate' ? run && ['queued', 'running', 'cancel_requested'].includes(run.status) : j.kind === 'apply' ? run?.status === 'applying' : run?.status === 'needs_reconciliation';
            if (j.status === 'sent' && j.nextAttemptAt <= now && relevant && (!c || c.expiresAt <= now)) {
                this.jobs.set(k, { ...j, status: 'pending', nextAttemptAt: now });
                count++;
            }
        }
        return count;
    }
    async resolveWork(item: WorkItem) {
        const job = this.jobs.get(key(item.scopeId, item.id));
        if (!job || job.runId !== item.runId || job.conversationId !== item.conversationId || job.kind !== item.kind)
            return null;
        const s = this.states.get(key(item.scopeId, item.conversationId));
        const scope = this.scopes.get(item.scopeId);
        if (!s || !scope || !s.runs.some(r => r.id === item.runId))
            return null;
        return { state: clone(s), ownerId: s.ownerId, scope: clone(scope) };
    }
}
