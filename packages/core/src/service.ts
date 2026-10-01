import type { ConversationClient } from '../../client/src/port.js';
import type { AcceptedRun, CommandOptions, ContextView, Conversation, ConversationEvent, EventPage, Message, Principal, Proposal, Result, Run, SkillRevision, Snapshot, ToolAdapter } from './domain.js';
import type { Manifest, Receipt, Repository, Scope, StoredConversation, WorkItem } from './repository.js';
import { asJson, bool, canonical, clone, ConflictError, digest, DomainError, failed, hash, id, integer, invalid, LIMITS, object, requestKey, requireCapability, sha256, text, throwIfAborted, title } from './validation.js';
export interface Clock {
    now(): number;
    id(prefix: string): string;
}
export const realClock: Clock = { now: () => Date.now(), id: prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` };
export interface Host extends ToolAdapter {
    inspect(principal: Principal, conversationId: string): Promise<Manifest['host']>;
}
export const ACTIVE: ReadonlySet<Run['status']> = new Set(['queued', 'running', 'awaiting_approval', 'applying', 'cancel_requested', 'needs_reconciliation']);
const TERMINAL_RETRY = new Set<Run['status']>(['failed', 'cancelled']);
export function iso(clock: Clock): string { return new Date(clock.now()).toISOString(); }
export async function scopeFor(principal: Principal): Promise<Scope> {
    requireCapability(principal, 'conversations:read');
    return { id: `s_${await digest([principal.tenantId, principal.applicationId, principal.workspaceId])}`, tenantId: principal.tenantId, applicationId: principal.applicationId, workspaceId: principal.workspaceId };
}
function notFound(): never { throw new DomainError('NOT_FOUND', 'Resource not found.'); }
function getRun(state: StoredConversation, runId: string): Run { return state.runs.find(r => r.id === id(runId)) ?? notFound(); }
function getProposal(state: StoredConversation, proposalId: string): Proposal { return state.proposals.find(p => p.id === id(proposalId)) ?? notFound(); }
export function touch(state: StoredConversation, at: string): void {
    state.conversation.revision++;
    state.conversation.updatedAt = at;
    const active = state.runs.find(r => ACTIVE.has(r.status));
    state.conversation.activeRun = active ? { id: active.id, status: active.status } : null;
}
/** Materialize complete checkpoints. Conversation metadata is always the final event,
 * with its cursor equal to the same transactional cut. */
export function changes(before: StoredConversation | null, state: StoredConversation, at: string, extra: ConversationEvent[] = []): ConversationEvent[] {
    const events: ConversationEvent[] = [];
    let seq = before?.conversation.lastEventSeq ?? 0;
    function emit(type: ConversationEvent['type'], payload: unknown) {
        events.push({ schemaVersion: 1, conversationId: state.conversation.id, seq: ++seq, at, type, payload } as ConversationEvent);
    }
    for (const m of state.messages) {
        const prev = before?.messages.find(p => p.id === m.id);
        if (!prev)
            m.createdSeq = seq + 1;
        if (!prev || canonical(prev) !== canonical(m))
            emit('message.upsert', clone(m));
    }
    for (const r of state.runs)
        if (canonical(before?.runs.find(p => p.id === r.id) ?? null) !== canonical(r))
            emit('run.upsert', clone(r));
    for (const p of state.proposals)
        if (canonical(before?.proposals.find(x => x.id === p.id) ?? null) !== canonical(p))
            emit('proposal.upsert', clone(p));
    for (const e of extra)
        emit(e.type, e.payload);
    state.conversation.lastEventSeq = seq + 1;
    emit('conversation.upsert', clone(state.conversation));
    return events;
}
export function workItem(clock: Clock, scopeId: string, conversationId: string, runId: string, kind: WorkItem['kind']): WorkItem {
    const at = iso(clock);
    return { id: clock.id('job'), scopeId, conversationId, runId, kind, status: 'pending', attempt: 0, nextAttemptAt: at, createdAt: at };
}
/** Domain service: no renderer, HTTP router, provider SDK, or global identity. */
export class ConversationService implements ConversationClient {
    private readonly scopePromise: Promise<Scope>;
    readonly principal: Principal;
    constructor(readonly repository: Repository, principal: Principal, readonly host: Host, readonly clock: Clock = realClock) {
        this.principal = clone(principal); // callers cannot mutate authority under an in-flight command
        this.scopePromise = scopeFor(this.principal);
    }
    async scope(): Promise<Scope> { const s = await this.scopePromise; await this.repository.ensureScope(s); return s; }
    private async read<T>(cap: Principal['capabilities'][number], fn: (scope: Scope) => Promise<T>, signal?: AbortSignal): Promise<Result<T>> {
        const requestId = this.clock.id('req');
        try {
            throwIfAborted(signal);
            requireCapability(this.principal, cap);
            const value = await fn(await this.scope());
            throwIfAborted(signal);
            return { ok: true, value: clone(value), requestId };
        }
        catch (error) {
            if (error instanceof DomainError)
                return failed(error, requestId);
            throw error;
        }
    }
    private async current(scope: Scope, conversationId: string): Promise<StoredConversation> {
        return await this.repository.get(scope.id, this.principal.actorId, id(conversationId)) ?? notFound();
    }
    private async command<T>(operation: string, payload: unknown, options: CommandOptions, cap: Principal['capabilities'][number], apply: (scope: Scope, receipt: Receipt) => Promise<T>): Promise<Result<T>> {
        return this.read(cap, async (scope) => {
            for (const segment of operation.split(':').slice(1))
                id(segment);
            const key = requestKey(options.requestKey);
            const payloadHash = await digest(payload);
            const recorded = await this.repository.receipt(scope.id, this.principal.actorId, operation, key);
            const recover = (r: Receipt): T => {
                if (r.payloadHash !== payloadHash)
                    throw new DomainError('IDEMPOTENCY_CONFLICT', 'This key was already used for a different request.');
                return clone(r.value) as T;
            };
            if (recorded)
                return recover(recorded);
            const receipt: Receipt = { operation, key, payloadHash, status: 200, value: null, at: iso(this.clock) };
            try {
                return await apply(scope, receipt);
            }
            catch (error) {
                if (error instanceof ConflictError) {
                    const won = await this.repository.receipt(scope.id, this.principal.actorId, operation, key);
                    if (won)
                        return recover(won);
                    throw new DomainError('STALE_REVISION', 'State changed. Refresh before issuing a new command.');
                }
                throw error;
            }
        }, options.signal);
    }
    private async save<T>(scope: Scope, before: StoredConversation | null, state: StoredConversation, receipt: Receipt, value: T, outbox: WorkItem[] = []): Promise<T> {
        const events = changes(before, state, iso(this.clock));
        receipt.value = asJson(value);
        await this.repository.commit({ scope, actorId: this.principal.actorId, beforeRevision: before?.conversation.revision ?? null, state, events, receipt, outbox });
        return clone(value);
    }
    private assertWritable(state: StoredConversation): void {
        if (state.conversation.archived)
            throw new DomainError('CONVERSATION_ARCHIVED', 'Restore this conversation before continuing.');
        if (state.runs.some(r => ACTIVE.has(r.status)))
            throw new DomainError('RUN_IN_PROGRESS', 'A run is still active.');
        if (state.runs.length >= LIMITS.runsPerConversation || state.messages.length >= LIMITS.messagesPerConversation - 1)
            throw new DomainError('QUOTA_EXCEEDED', 'This recipe conversation has reached its configured size limit.');
    }
    private assertRevision(state: StoredConversation, revision: number): void {
        if (state.conversation.revision !== integer(revision, 1))
            throw new DomainError('STALE_REVISION', 'The conversation changed. Refresh before continuing.');
    }
    async list(query: {
        archived?: boolean;
        search?: string;
        cursor?: string;
    }, signal?: AbortSignal): Promise<Result<{
        items: Conversation[];
        nextCursor: string | null;
    }>> {
        return this.read('conversations:read', async (scope) => {
            const q = object(query, ['archived', 'search', 'cursor']);
            const archived = q.archived === undefined ? false : bool(q.archived);
            const search = q.search === undefined ? '' : text(q.search, 400, 0).toLocaleLowerCase();
            const rows = (await this.repository.list(scope.id, this.principal.actorId)).filter(c => c.archived === archived && c.title.toLocaleLowerCase().includes(search)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
            let index = 0;
            if (q.cursor !== undefined) {
                const cursor = id(q.cursor);
                index = rows.findIndex(c => c.id === cursor) + 1;
                if (index === 0)
                    throw new DomainError('CURSOR_INVALID', 'List changed; restart pagination.');
            }
            const items = rows.slice(index, index + LIMITS.listSize);
            return { items, nextCursor: index + items.length < rows.length ? items.at(-1)!.id : null };
        }, signal);
    }
    async create(input: {
        title?: string;
    }, options: CommandOptions): Promise<Result<Conversation>> {
        // Validation happens inside the Result boundary, even for non-TypeScript callers.
        return this.command('create', input, options, 'conversations:write', async (scope, receipt) => {
            const body = object(input, ['title']);
            const name = body.title === undefined ? 'New conversation' : title(body.title);
            const at = iso(this.clock);
            const conversation: Conversation = { id: this.clock.id('conv'), title: name, archived: false, revision: 1, lastEventSeq: 1, createdAt: at, updatedAt: at, activeRun: null };
            const state: StoredConversation = { scopeId: scope.id, ownerId: this.principal.actorId, conversation, messages: [], runs: [], proposals: [], manifests: [], claims: {} };
            return this.save(scope, null, state, receipt, conversation);
        });
    }
    async snapshot(conversationId: string, signal?: AbortSignal): Promise<Result<Snapshot>> {
        return this.read('conversations:read', async (scope) => {
            const s = await this.current(scope, conversationId);
            const messages = s.messages.slice(-LIMITS.messagePageSize);
            // Run/proposal metadata is bounded by the hard per-conversation run limit.
            return { conversation: s.conversation, messages, runs: s.runs, proposals: s.proposals, throughEventSeq: s.conversation.lastEventSeq, nextMessagePage: s.messages.length > messages.length ? messages[0]!.id : null };
        }, signal);
    }
    async history(conversationId: string, before: string, signal?: AbortSignal): Promise<Result<{
        messages: Message[];
        nextCursor: string | null;
    }>> {
        return this.read('conversations:read', async (scope) => {
            const s = await this.current(scope, conversationId);
            const index = s.messages.findIndex(m => m.id === id(before));
            if (index < 0)
                throw new DomainError('CURSOR_INVALID', 'Unknown message cursor.');
            const start = Math.max(0, index - LIMITS.messagePageSize);
            const messages = s.messages.slice(start, index);
            return { messages, nextCursor: start > 0 ? messages[0]!.id : null };
        }, signal);
    }
    async export(conversationId: string, signal?: AbortSignal): Promise<Result<{
        schemaVersion: 1;
        snapshot: Snapshot;
    }>> {
        return this.read('conversations:read', async (scope) => {
            const s = await this.current(scope, conversationId);
            return { schemaVersion: 1, snapshot: { conversation: s.conversation, messages: s.messages, runs: s.runs, proposals: s.proposals, throughEventSeq: s.conversation.lastEventSeq, nextMessagePage: null } };
        }, signal);
    }
    async events(conversationId: string, after: number, signal?: AbortSignal): Promise<Result<EventPage>> {
        return this.read('conversations:read', async (scope) => {
            integer(after);
            const s = await this.current(scope, conversationId);
            if (after > s.conversation.lastEventSeq)
                throw new DomainError('CURSOR_INVALID', 'Cursor is ahead of the conversation.');
            const rows = await this.repository.events(scope.id, this.principal.actorId, conversationId, after) ?? notFound();
            let size = 0;
            const events: ConversationEvent[] = [];
            for (const row of rows) {
                const n = new TextEncoder().encode(JSON.stringify(row)).length;
                if (events.length >= LIMITS.eventPageSize || size + n > LIMITS.pageBytes)
                    break;
                events.push(row);
                size += n;
            }
            if (!events.length && rows.length)
                throw new DomainError('RESYNC_REQUIRED', 'Stored event cannot fit in the configured page.');
            if (events.length && events[0]!.seq !== after + 1)
                throw new DomainError('RESYNC_REQUIRED', 'This replay window is unavailable.');
            const nextCursor = events.at(-1)?.seq ?? after;
            return { events, nextCursor, hasMore: rows.length > events.length };
        }, signal);
    }
    async update(conversationId: string, input: {
        expectedRevision: number;
        title?: string;
        archived?: boolean;
    }, options: CommandOptions): Promise<Result<Conversation>> {
        return this.command(`update:${conversationId}`, input, options, 'conversations:write', async (scope, receipt) => {
            const b = object(input, ['expectedRevision', 'title', 'archived']);
            if (b.title === undefined && b.archived === undefined)
                invalid();
            const before = await this.current(scope, conversationId);
            this.assertRevision(before, integer(b.expectedRevision, 1));
            const s = clone(before);
            if (b.title !== undefined)
                s.conversation.title = title(b.title);
            if (b.archived !== undefined) {
                if (bool(b.archived) && s.conversation.activeRun)
                    throw new DomainError('RUN_IN_PROGRESS', 'Resolve the active run before archiving.');
                s.conversation.archived = bool(b.archived);
            }
            touch(s, iso(this.clock));
            return this.save(scope, before, s, receipt, s.conversation);
        });
    }
    private async manifest(scope: Scope, s: StoredConversation, input: Message): Promise<Manifest> {
        const revisions: SkillRevision[] = [];
        for (const skill of await this.repository.skills(scope.id)) {
            const revision = (await this.repository.versions(scope.id, skill.id)).find(r => r.version === skill.headVersion);
            if (!revision)
                throw new Error('Stored skill head is missing');
            revisions.push(revision);
        }
        const selected = s.messages.filter(m => m.id === input.id || m.state === 'complete' || m.role === 'user').slice(-12);
        const m: Manifest = { snapshotId: this.clock.id('ctx'), throughEventSeq: s.conversation.lastEventSeq + (input.createdSeq === 0 ? 1 : 0), selectedMessageIds: selected.map(m => m.id), summaryThroughEventSeq: null, skillPins: revisions.map(r => ({ skillId: r.skillId, version: r.version, bodyHash: r.bodyHash })), cache: { application: 'disabled', provider: 'unknown' }, policy: 'recipe-v1', provider: 'fake-v1', messages: selected.map(m => ({ id: m.id, role: m.role, text: m.parts.map(p => p.text).join('') })), skills: revisions, host: await this.host.inspect(this.principal, s.conversation.id), tool: { id: this.host.id, version: this.host.version }, hash: '' };
        if (new TextEncoder().encode(canonical(m)).length > LIMITS.contextBytes)
            throw new DomainError('QUOTA_EXCEEDED', 'Selected context exceeds the configured bound.');
        m.hash = await digest({ ...m, hash: '' });
        return m;
    }
    private newRun(s: StoredConversation, input: Message, m: Manifest, retry: string | null, refresh: string | null): Run {
        const at = iso(this.clock);
        const run: Run = { id: this.clock.id('run'), conversationId: s.conversation.id, inputMessageId: input.id, contextSnapshotId: m.snapshotId, status: 'queued', revision: 1, retryOfRunId: retry, refreshOfProposalId: refresh, skillPins: clone(m.skillPins), createdAt: at, updatedAt: at, outcome: null, error: null };
        s.runs.push(run);
        return run;
    }
    async send(conversationId: string, input: {
        text: string;
        expectedRevision: number;
    }, options: CommandOptions): Promise<Result<AcceptedRun>> {
        return this.command(`send:${conversationId}`, input, options, 'conversations:write', async (scope, receipt) => {
            const b = object(input, ['text', 'expectedRevision']);
            const content = text(b.text, LIMITS.inputBytes);
            if (!content.trim())
                invalid('Write a message first.');
            const before = await this.current(scope, conversationId);
            this.assertRevision(before, integer(b.expectedRevision, 1));
            this.assertWritable(before);
            const s = clone(before);
            const at = iso(this.clock);
            const message: Message = { id: this.clock.id('msg'), conversationId, runId: null, role: 'user', parts: [{ type: 'text', text: content }], state: 'accepted', createdSeq: 0, createdAt: at };
            s.messages.push(message);
            const manifest = await this.manifest(scope, s, message);
            s.manifests.push(manifest);
            const run = this.newRun(s, message, manifest, null, null);
            message.runId = run.id;
            touch(s, at);
            const value: AcceptedRun = { conversationId, runId: run.id, messageId: message.id, acceptedSeq: before.conversation.lastEventSeq + 1 };
            receipt.status = 202;
            return this.save(scope, before, s, receipt, value, [workItem(this.clock, scope.id, conversationId, run.id, 'generate')]);
        });
    }
    async cancel(conversationId: string, runId: string, options: CommandOptions): Promise<Result<Run>> {
        return this.command(`cancel:${conversationId}:${runId}`, {}, options, 'conversations:write', async (scope, receipt) => {
            const before = await this.current(scope, conversationId);
            const s = clone(before);
            const r = getRun(s, runId);
            if (r.status === 'applying' || r.status === 'needs_reconciliation')
                throw new DomainError('TOOL_RESULT_UNKNOWN', 'An accepted effect cannot be cancelled as if it never happened.');
            if (!ACTIVE.has(r.status)) {
                touch(s, iso(this.clock));
                receipt.value = asJson(r);
                await this.save(scope, before, s, receipt, r);
                return r;
            }
            r.status = r.status === 'running' || r.status === 'cancel_requested' ? 'cancel_requested' : 'cancelled';
            r.revision++;
            r.updatedAt = iso(this.clock);
            for (const p of s.proposals.filter(p => p.runId === runId && p.status === 'pending'))
                p.status = 'rejected';
            for (const m of s.messages.filter(m => m.runId === runId && m.state === 'streaming'))
                m.state = 'partial';
            touch(s, iso(this.clock));
            receipt.status = 202;
            return this.save(scope, before, s, receipt, r);
        });
    }
    async retry(conversationId: string, runId: string, options: CommandOptions): Promise<Result<AcceptedRun>> {
        return this.command(`retry:${conversationId}:${runId}`, {}, options, 'conversations:write', async (scope, receipt) => {
            const before = await this.current(scope, conversationId);
            const original = getRun(before, runId);
            if (!TERMINAL_RETRY.has(original.status) || before.proposals.some(p => p.runId === runId && ['approved', 'applied', 'unknown'].includes(p.status)))
                invalid('Only failed/cancelled generations without unresolved effects can be retried.');
            this.assertWritable(before);
            const s = clone(before);
            const m = s.manifests.find(m => m.snapshotId === original.contextSnapshotId) ?? notFound();
            const input = s.messages.find(m => m.id === original.inputMessageId) ?? notFound();
            const run = this.newRun(s, input, m, runId, null);
            touch(s, iso(this.clock));
            const value = { conversationId, runId: run.id, messageId: input.id, acceptedSeq: before.conversation.lastEventSeq + 1 };
            receipt.status = 202;
            return this.save(scope, before, s, receipt, value, [workItem(this.clock, scope.id, conversationId, run.id, 'generate')]);
        });
    }
    async decide(conversationId: string, proposalId: string, input: {
        decision: 'approve' | 'reject';
        payloadHash: string;
    }, options: CommandOptions): Promise<Result<Proposal>> {
        return this.command(`decide:${conversationId}:${proposalId}`, input, options, 'tools:approve', async (scope, receipt) => {
            const b = object(input, ['decision', 'payloadHash']);
            if (b.decision !== 'approve' && b.decision !== 'reject')
                invalid();
            const before = await this.current(scope, conversationId);
            const s = clone(before);
            const p = getProposal(s, proposalId);
            const run = getRun(s, p.runId);
            if (p.payloadHash !== hash(b.payloadHash))
                throw new DomainError('STALE_PROPOSAL', 'The reviewed payload no longer matches.');
            if (p.status !== 'pending' || run.status !== 'awaiting_approval')
                throw new DomainError('PROPOSAL_NOT_PENDING', 'This proposal already has a decision.');
            if (!(await this.host.authorize(this.principal, p.action)))
                throw new DomainError('FORBIDDEN', 'Host permission denied.');
            const outbox: WorkItem[] = [];
            if (b.decision === 'approve') {
                p.status = 'approved';
                run.status = 'applying';
                outbox.push(workItem(this.clock, scope.id, conversationId, run.id, 'apply'));
            }
            else {
                p.status = 'rejected';
                run.status = 'completed';
                run.outcome = 'rejected';
            }
            run.revision++;
            run.updatedAt = iso(this.clock);
            touch(s, iso(this.clock));
            receipt.status = 202;
            return this.save(scope, before, s, receipt, p, outbox);
        });
    }
    async refreshProposal(conversationId: string, proposalId: string, options: CommandOptions): Promise<Result<AcceptedRun>> {
        return this.command(`refresh:${conversationId}:${proposalId}`, {}, options, 'conversations:write', async (scope, receipt) => {
            const before = await this.current(scope, conversationId);
            const p = getProposal(before, proposalId);
            if (p.status !== 'stale')
                invalid('Only a stale proposal can be refreshed.');
            this.assertWritable(before);
            const s = clone(before);
            const original = getRun(s, p.runId);
            const input = s.messages.find(m => m.id === original.inputMessageId) ?? notFound();
            const m = await this.manifest(scope, s, input);
            s.manifests.push(m);
            const run = this.newRun(s, input, m, null, proposalId);
            touch(s, iso(this.clock));
            const value = { conversationId, runId: run.id, messageId: input.id, acceptedSeq: before.conversation.lastEventSeq + 1 };
            receipt.status = 202;
            return this.save(scope, before, s, receipt, value, [workItem(this.clock, scope.id, conversationId, run.id, 'generate')]);
        });
    }
    async context(conversationId: string, runId: string, signal?: AbortSignal): Promise<Result<ContextView>> {
        return this.read('conversations:read', async (scope) => {
            const s = await this.current(scope, conversationId);
            const run = getRun(s, runId);
            const m = s.manifests.find(m => m.snapshotId === run.contextSnapshotId) ?? notFound();
            return { snapshotId: m.snapshotId, throughEventSeq: m.throughEventSeq, skillPins: m.skillPins, selectedMessageIds: m.selectedMessageIds, summaryThroughEventSeq: m.summaryThroughEventSeq, cache: m.cache };
        }, signal);
    }
    async skills(signal?: AbortSignal) { return this.read('conversations:read', scope => this.repository.skills(scope.id), signal); }
    async skillHistory(skillId: string, cursor?: string, signal?: AbortSignal): Promise<Result<{
        items: SkillRevision[];
        nextCursor: string | null;
    }>> {
        return this.read('conversations:read', async (scope) => {
            const versions = (await this.repository.versions(scope.id, id(skillId))).sort((a, b) => b.version - a.version);
            if (!versions.length)
                notFound();
            let after = Number.MAX_SAFE_INTEGER;
            if (cursor !== undefined) {
                if (!/^[1-9][0-9]*$/.test(cursor))
                    throw new DomainError('CURSOR_INVALID', 'Invalid version cursor.');
                after = integer(Number(cursor), 1);
            }
            const rest = versions.filter(v => v.version < after);
            const items = rest.slice(0, 50);
            return { items, nextCursor: rest.length > items.length ? String(items.at(-1)!.version) : null };
        }, signal);
    }
    private async append(scope: Scope, skillId: string, expectedHead: number, body: string, note: string, source: number | null, receipt: Receipt): Promise<SkillRevision> {
        const skill = (await this.repository.skills(scope.id)).find(s => s.id === id(skillId)) ?? notFound();
        if (skill.headVersion !== expectedHead)
            throw new DomainError('STALE_REVISION', 'The skill has a newer revision.');
        const revision: SkillRevision = { skillId, version: expectedHead + 1, body, bodyHash: await sha256(body), note, createdAt: iso(this.clock), restoredFromVersion: source };
        receipt.value = asJson(revision);
        receipt.status = 201;
        await this.repository.appendSkill({ scope, actorId: this.principal.actorId, skill, expectedHead, revision, receipt });
        return revision;
    }
    async saveSkill(skillId: string, input: {
        expectedHead: number;
        body: string;
        note: string;
    }, options: CommandOptions): Promise<Result<SkillRevision>> {
        return this.command(`skill:${skillId}`, input, options, 'skills:write', async (scope, receipt) => {
            const b = object(input, ['expectedHead', 'body', 'note']);
            return this.append(scope, skillId, integer(b.expectedHead, 1), text(b.body, LIMITS.skillBytes), text(b.note, 512, 0), null, receipt);
        });
    }
    async restoreSkill(skillId: string, input: {
        expectedHead: number;
        sourceVersion: number;
    }, options: CommandOptions): Promise<Result<SkillRevision>> {
        return this.command(`restore:${skillId}`, input, options, 'skills:write', async (scope, receipt) => {
            const b = object(input, ['expectedHead', 'sourceVersion']);
            const source = integer(b.sourceVersion, 1);
            const rev = (await this.repository.versions(scope.id, skillId)).find(r => r.version === source) ?? notFound();
            return this.append(scope, skillId, integer(b.expectedHead, 1), rev.body, `Restored version ${source}`, source, receipt);
        });
    }
}
