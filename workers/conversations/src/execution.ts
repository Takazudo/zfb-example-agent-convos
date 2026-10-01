import type { ConversationEvent, Principal, Proposal, Run } from '../../../packages/core/src/domain.js';
import type { Claim, Manifest, Repository, Scope, StoredConversation, WorkItem, Write } from '../../../packages/core/src/repository.js';
import { changes, type Clock, type Host, iso, realClock, touch, workItem } from '../../../packages/core/src/service.js';
import { clone, ConflictError, digest, LIMITS, requireCapability, text } from '../../../packages/core/src/validation.js';
export interface Provider {
    generate(manifest: Manifest, options: {
        signal: AbortSignal;
        checkpoint(text: string): Promise<void>;
    }): Promise<{
        kind: 'text';
        text: string;
    } | {
        kind: 'proposal';
        text: string;
        body: string;
        title: string;
    }>;
}
export interface QueuePort {
    send(item: WorkItem): Promise<void>;
}
export type AuthorityResolver = (scope: Scope, ownerId: string) => Promise<Principal | null>;
export const LEASE_MS = 30000;
const MAX_ATTEMPTS = 3;
/** The queue is at-least-once. Its acknowledgement is not the durable acceptance boundary. */
export async function dispatchOutbox(repository: Repository, queue: QueuePort, clock: Clock = realClock): Promise<number> {
    let count = 0;
    for (const item of await repository.work(iso(clock))) {
        await queue.send(item);
        // A crash here leaves a pending item; sending it twice must be harmless.
        await repository.markSent(item, new Date(clock.now() + LEASE_MS).toISOString());
        count++;
    }
    return count;
}
interface Owned {
    scope: Scope;
    ownerId: string;
    claim: Claim;
    principal: Principal;
}
export class ExecutionRuntime {
    constructor(readonly repository: Repository, readonly host: Host, readonly provider: Provider, readonly resolveAuthority: AuthorityResolver, readonly clock: Clock = realClock) { }
    private async own(item: WorkItem): Promise<Owned | null> {
        const resolved = await this.repository.resolveWork(item);
        if (!resolved)
            return null;
        const before = resolved.state;
        const run = before.runs.find(r => r.id === item.runId)!;
        const expected = item.kind === 'generate' ? ['queued', 'running', 'cancel_requested'] : item.kind === 'apply' ? ['applying'] : ['needs_reconciliation'];
        if (!expected.includes(run.status))
            return null;
        const previous = before.claims[run.id];
        const at = iso(this.clock);
        if (previous && previous.expiresAt > at)
            return null;
        const principal = await this.resolveAuthority(resolved.scope, resolved.ownerId);
        if (!principal || principal.actorId !== resolved.ownerId || principal.tenantId !== resolved.scope.tenantId || principal.applicationId !== resolved.scope.applicationId || principal.workspaceId !== resolved.scope.workspaceId)
            return null;
        requireCapability(principal, 'conversations:write');
        const state = clone(before);
        const next = state.runs.find(r => r.id === run.id)!;
        const claim: Claim = { token: this.clock.id('claim'), generation: (previous?.generation ?? 0) + 1, attempt: (previous?.attempt ?? 0) + 1, expiresAt: new Date(this.clock.now() + LEASE_MS).toISOString() };
        state.claims[run.id] = claim;
        if (run.status === 'cancel_requested')
            next.status = 'cancelled';
        else if (item.kind === 'generate') {
            if (claim.attempt > MAX_ATTEMPTS) {
                next.status = 'failed';
                next.error = { code: 'PROVIDER_UNAVAILABLE', safeMessage: 'Automatic generation recovery limit reached.', retryable: true };
            }
            else
                next.status = 'running';
        }
        if (next.status === 'cancelled' || next.status === 'failed')
            for (const m of state.messages.filter(m => m.runId === run.id && m.state === 'streaming'))
                m.state = 'partial';
        next.revision++;
        next.updatedAt = at;
        touch(state, at);
        try {
            await this.repository.commit({ scope: resolved.scope, actorId: resolved.ownerId, beforeRevision: before.conversation.revision, state, events: changes(before, state, at), receipt: null, outbox: [] });
        }
        catch (error) {
            if (error instanceof ConflictError)
                return null;
            throw error;
        }
        if (next.status === 'cancelled' || next.status === 'failed')
            return null;
        return { scope: resolved.scope, ownerId: resolved.ownerId, claim, principal };
    }
    private async edit(item: WorkItem, owned: Owned, apply: (state: StoredConversation, run: Run, extra: ConversationEvent[], jobs: WorkItem[]) => void): Promise<boolean> {
        const before = await this.repository.get(owned.scope.id, owned.ownerId, item.conversationId);
        if (!before)
            return false;
        const c = before.claims[item.runId];
        const at = iso(this.clock);
        if (!c || c.token !== owned.claim.token || c.generation !== owned.claim.generation || c.expiresAt <= at)
            return false;
        const state = clone(before);
        const run = state.runs.find(r => r.id === item.runId)!;
        const extra: ConversationEvent[] = [];
        const outbox: WorkItem[] = [];
        apply(state, run, extra, outbox);
        run.revision++;
        run.updatedAt = at;
        touch(state, at);
        const write: Write = { scope: owned.scope, actorId: owned.ownerId, beforeRevision: before.conversation.revision, state, events: changes(before, state, at, extra), receipt: null, outbox, claimFence: { runId: item.runId, token: owned.claim.token, generation: owned.claim.generation, now: at } };
        try {
            await this.repository.commit(write);
            return true;
        }
        catch (error) {
            if (error instanceof ConflictError)
                return false;
            throw error;
        }
    }
    private message(state: StoredConversation, run: Run, value: string, final: boolean): void {
        const content = text(value, LIMITS.outputBytes, 0);
        const id = `reply_${run.id}`;
        let m = state.messages.find(m => m.id === id);
        if (!m) {
            m = { id, conversationId: run.conversationId, runId: run.id, role: 'assistant', parts: [], state: 'streaming', createdSeq: 0, createdAt: iso(this.clock) };
            state.messages.push(m);
        }
        m.parts = [{ type: 'text', text: content }];
        m.state = final ? 'complete' : 'streaming';
    }
    private cancel(state: StoredConversation, run: Run) {
        run.status = 'cancelled';
        for (const m of state.messages.filter(m => m.runId === run.id && m.state === 'streaming'))
            m.state = 'partial';
        // Keep generation metadata to prevent ABA after an abandoned claimant resumes.
        const claim = state.claims[run.id];
        if (claim)
            claim.expiresAt = iso(this.clock);
    }
    async deliver(item: WorkItem): Promise<boolean> {
        const owned = await this.own(item);
        if (!owned)
            return false;
        if (item.kind === 'generate')
            await this.generate(item, owned);
        else if (item.kind === 'apply')
            await this.apply(item, owned);
        else
            await this.reconcile(item, owned);
        return true;
    }
    private async generate(item: WorkItem, owned: Owned) {
        const state = await this.repository.get(owned.scope.id, owned.ownerId, item.conversationId);
        if (!state)
            return;
        const run = state.runs.find(r => r.id === item.runId)!;
        const manifest = state.manifests.find(m => m.snapshotId === run.contextSnapshotId)!;
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(new Error('Provider deadline exceeded')), 25000);
        try {
            const result = await this.provider.generate(clone(manifest), { signal: abort.signal, checkpoint: async (value) => {
                    let cancelled = false;
                    const applied = await this.edit(item, owned, (s, r) => {
                        if (r.status === 'cancel_requested') {
                            this.cancel(s, r);
                            cancelled = true;
                            return;
                        }
                        if (r.status !== 'running')
                            throw new Error('Unexpected generation state');
                        this.message(s, r, value, false);
                    });
                    if (!applied || cancelled) {
                        abort.abort();
                        throw new Error('Generation lost its claim or was cancelled');
                    }
                } });
            abort.signal.throwIfAborted();
            let p: Proposal | null = null;
            if (result.kind === 'proposal') {
                const action = { toolId: this.host.id, toolVersion: this.host.version, resourceId: manifest.host.resourceId, args: this.host.validateArgs({ body: text(result.body, LIMITS.outputBytes) }) };
                const display = { title: text(result.title, 480), path: manifest.host.resourceId, before: manifest.host.text, after: result.body };
                p = { id: this.clock.id('proposal'), conversationId: item.conversationId, runId: item.runId, status: 'pending', action, baseRevision: manifest.host.revision, display, payloadHash: await digest({ action, baseRevision: manifest.host.revision, display }), createdAt: iso(this.clock) };
            }
            await this.edit(item, owned, (s, r) => {
                if (r.status === 'cancel_requested') {
                    this.cancel(s, r);
                    return;
                }
                if (r.status !== 'running')
                    return;
                this.message(s, r, result.text, true);
                const input = s.messages.find(m => m.id === r.inputMessageId);
                if (input)
                    input.state = 'complete';
                if (p) {
                    s.proposals.push(p);
                    r.status = 'awaiting_approval';
                }
                else {
                    r.status = 'completed';
                    r.outcome = 'read_only';
                }
                s.claims[r.id]!.expiresAt = iso(this.clock);
            });
        }
        catch {
            await this.edit(item, owned, (s, r) => {
                if (r.status === 'cancel_requested' || r.status === 'cancelled') {
                    this.cancel(s, r);
                    return;
                }
                if (r.status !== 'running')
                    return;
                r.status = 'failed';
                r.error = { code: 'PROVIDER_UNAVAILABLE', safeMessage: 'Generation was interrupted. The accepted request is retained.', retryable: true };
                for (const m of s.messages.filter(m => m.runId === r.id && m.state === 'streaming'))
                    m.state = 'partial';
                s.claims[r.id]!.expiresAt = iso(this.clock);
            });
        }
        finally {
            clearTimeout(timeout);
        }
    }
    private async apply(item: WorkItem, owned: Owned) {
        const state = await this.repository.get(owned.scope.id, owned.ownerId, item.conversationId);
        if (!state)
            return;
        const p = state.proposals.find(p => p.runId === item.runId && p.status === 'approved');
        if (!p)
            return;
        const effectKey = `effect_${p.id}`;
        let result: Awaited<ReturnType<Host['apply']>>;
        // Apply adapters must recheck authority/revision within their own write boundary.
        try {
            if (!owned.principal.capabilities.includes('tools:approve') || !(await this.host.authorize(owned.principal, p.action))) {
                result = { outcome: 'failed', safeSummary: 'Host permission was revoked before execution.', retrySafe: false };
            }
            else {
                result = await this.host.apply({ principal: owned.principal, effectKey, action: p.action, expectedRevision: p.baseRevision, signal: AbortSignal.timeout(20000) });
            }
        }
        catch {
            result = { outcome: 'unknown', safeSummary: 'The host response was lost. Reconciliation is required.' };
        }
        await this.edit(item, owned, (s, r, extra, jobs) => {
            if (r.status !== 'applying')
                return;
            const proposal = s.proposals.find(x => x.id === p.id)!;
            let outcome: 'succeeded' | 'failed' | 'unknown';
            let summary: string;
            if (result.outcome === 'succeeded') {
                proposal.status = 'applied';
                r.status = 'completed';
                r.outcome = 'applied';
                outcome = 'succeeded';
                summary = result.safeSummary;
            }
            else if (result.outcome === 'conflict') {
                proposal.status = 'stale';
                r.status = 'conflicted';
                r.error = { code: 'STALE_PROPOSAL', safeMessage: 'The host changed. Prepare a fresh proposal; nothing was overwritten.', retryable: false };
                outcome = 'failed';
                summary = 'Host revision conflict; no write.';
            }
            else if (result.outcome === 'failed') {
                proposal.status = 'rejected';
                r.status = 'failed';
                r.error = { code: 'FORBIDDEN', safeMessage: result.safeSummary, retryable: false };
                outcome = 'failed';
                summary = result.safeSummary;
            }
            else {
                proposal.status = 'unknown';
                r.status = 'needs_reconciliation';
                r.error = { code: 'TOOL_RESULT_UNKNOWN', safeMessage: result.safeSummary, retryable: false };
                outcome = 'unknown';
                summary = result.safeSummary;
                jobs.push(workItem(this.clock, owned.scope.id, item.conversationId, r.id, 'reconcile'));
            }
            s.claims[r.id]!.expiresAt = iso(this.clock);
            extra.push({ schemaVersion: 1, conversationId: item.conversationId, seq: 0, at: iso(this.clock), type: 'tool.receipt', payload: { effectKey, proposalId: p.id, outcome, safeSummary: summary } });
        });
    }
    private async reconcile(item: WorkItem, owned: Owned) {
        const state = await this.repository.get(owned.scope.id, owned.ownerId, item.conversationId);
        if (!state)
            return;
        const p = state.proposals.find(p => p.runId === item.runId && p.status === 'unknown');
        if (!p)
            return;
        const effectKey = `effect_${p.id}`;
        let result: Awaited<ReturnType<Host['reconcile']>>;
        try {
            result = await this.host.reconcile({ principal: owned.principal, effectKey });
        }
        catch {
            result = { outcome: 'unknown' };
        }
        if (result.outcome === 'unknown')
            return; // durable state remains blocked; repair uses the expired lease
        await this.edit(item, owned, (s, r, extra) => {
            const proposal = s.proposals.find(x => x.id === p.id)!;
            if (result.outcome === 'succeeded') {
                proposal.status = 'applied';
                r.status = 'completed';
                r.outcome = 'applied';
                r.error = null;
            }
            else {
                proposal.status = 'rejected';
                r.status = 'failed';
                r.error = { code: 'TOOL_RESULT_UNKNOWN', safeMessage: 'Host confirms that the effect was not applied.', retryable: false };
            }
            s.claims[r.id]!.expiresAt = iso(this.clock);
            extra.push({ schemaVersion: 1, conversationId: item.conversationId, seq: 0, at: iso(this.clock), type: 'tool.receipt', payload: { effectKey, proposalId: p.id, outcome: result.outcome === 'succeeded' ? 'succeeded' : 'failed', safeSummary: result.outcome === 'succeeded' ? 'Recovered the host receipt; draft was saved once.' : 'Confirmed no host effect.' } });
        });
    }
}
