import type { Principal, ToolAdapter } from '../../core/src/domain.js';
import type { Host } from '../../core/src/service.js';
import { scopeFor } from '../../core/src/service.js';
import { clone, digest, DomainError, id, LIMITS, object, text } from '../../core/src/validation.js';
export interface HostResource {
    revision: string | null;
    text: string | null;
}
export interface EffectReceipt {
    payloadHash: string;
    outcome: 'succeeded' | 'conflict';
    resultingRevision: string | null;
}
export interface HostStore {
    read(scope: string): Promise<HostResource>;
    apply(scope: string, key: string, payloadHash: string, expected: string | null, body: string): Promise<EffectReceipt>;
    receipt(scope: string, key: string): Promise<EffectReceipt | null>;
    change(scope: string, body: string): Promise<void>;
}
export class MemoryHostStore implements HostStore {
    private resources = new Map<string, HostResource>();
    private effects = new Map<string, EffectReceipt>();
    writes = 0;
    async read(scope: string): Promise<HostResource> { return clone(this.resources.get(scope) ?? { revision: '7', text: '# October release\n\nDraft outline.' }); }
    async apply(scope: string, key: string, payloadHash: string, expected: string | null, body: string): Promise<EffectReceipt> {
        const k = JSON.stringify([scope, key]);
        const prev = this.effects.get(k);
        if (prev) {
            if (prev.payloadHash !== payloadHash)
                throw new DomainError('IDEMPOTENCY_CONFLICT', 'Effect key reused with different content.');
            return clone(prev);
        }
        const resource = await this.read(scope);
        // read() may have yielded. Recheck within the synchronous mutation section.
        const current = this.resources.get(scope) ?? resource;
        const receipt: EffectReceipt = current.revision !== expected ? { payloadHash, outcome: 'conflict', resultingRevision: current.revision } : { payloadHash, outcome: 'succeeded', resultingRevision: String(Number(current.revision ?? 0) + 1) };
        const raced = this.effects.get(k);
        if (raced) {
            if (raced.payloadHash !== payloadHash)
                throw new DomainError('IDEMPOTENCY_CONFLICT', 'Effect key reused.');
            return clone(raced);
        }
        if (receipt.outcome === 'succeeded') {
            this.resources.set(scope, { revision: receipt.resultingRevision, text: body });
            this.writes++;
        }
        this.effects.set(k, receipt);
        return clone(receipt);
    }
    async receipt(scope: string, key: string) { return clone(this.effects.get(JSON.stringify([scope, key])) ?? null); }
    async change(scope: string, body: string) { const current = await this.read(scope); this.resources.set(scope, { revision: String(Number(current.revision) + 1), text: body }); }
}
/** An example adapter. It is not a general CMS API and cannot publish anything. */
export class DemoHost implements Host {
    readonly id = 'demo-save-draft';
    readonly version = '1';
    deny = false;
    loseNextResponse = false;
    reconciliationUnavailable = false;
    constructor(readonly store: HostStore = new MemoryHostStore()) { }
    validateArgs(args: unknown) { const b = object(args, ['body']); return { body: text(b.body, LIMITS.outputBytes) }; }
    async authorize(principal: Principal, action: Parameters<ToolAdapter['authorize']>[1]) {
        return !this.deny && principal.capabilities.includes('tools:approve') && action.toolId === this.id && action.toolVersion === this.version && action.resourceId === 'release-page';
    }
    async inspect(principal: Principal, _conversationId: string) {
        const scope = await scopeFor(principal);
        return { resourceId: 'release-page', ...await this.store.read(scope.id) };
    }
    async apply(input: Parameters<ToolAdapter['apply']>[0]): Promise<Awaited<ReturnType<ToolAdapter['apply']>>> {
        input.signal.throwIfAborted();
        id(input.effectKey);
        if (!(await this.authorize(input.principal, input.action)))
            return { outcome: 'failed', safeSummary: 'Host permission denied.', retrySafe: false };
        const args = this.validateArgs(input.action.args);
        const scope = await scopeFor(input.principal);
        const payloadHash = await digest({ action: input.action, expectedRevision: input.expectedRevision });
        const r = await this.store.apply(scope.id, input.effectKey, payloadHash, input.expectedRevision, args.body);
        if (this.loseNextResponse) {
            this.loseNextResponse = false;
            return { outcome: 'unknown', safeSummary: 'Simulated lost response. The host may already have saved the draft.' };
        }
        if (r.outcome === 'conflict')
            return { outcome: 'conflict', actualRevision: r.resultingRevision };
        return { outcome: 'succeeded', resultingRevision: r.resultingRevision!, safeSummary: 'Draft saved in the demo host. Nothing was published.' };
    }
    async reconcile(input: Parameters<ToolAdapter['reconcile']>[0]): Promise<Awaited<ReturnType<ToolAdapter['reconcile']>>> {
        if (this.reconciliationUnavailable)
            return { outcome: 'unknown' };
        const scope = await scopeFor(input.principal);
        const r = await this.store.receipt(scope.id, id(input.effectKey));
        if (!r)
            return { outcome: 'unknown' }; // absence alone is not proof that an in-flight write never landed
        return r.outcome === 'succeeded' ? { outcome: 'succeeded', resultingRevision: r.resultingRevision! } : { outcome: 'not_applied' };
    }
    async externalChange(principal: Principal) { await this.store.change((await scopeFor(principal)).id, '# October release\n\nChanged by another editor.'); }
}
