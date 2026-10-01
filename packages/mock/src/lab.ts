import type { Principal } from '../../core/src/domain.js';
import type { Repository, WorkItem } from '../../core/src/repository.js';
import { ConversationService, type Clock, iso } from '../../core/src/service.js';
import { sha256 } from '../../core/src/validation.js';
import { dispatchOutbox, ExecutionRuntime } from '../../../workers/conversations/src/execution.js';
import { MemoryRepository } from './memory-repository.js';
import { DemoHost } from './demo-host.js';
import { FakeProvider } from './fake-provider.js';
export const DEMO_PRINCIPAL: Principal = { tenantId: 'demo', applicationId: 'recipe', workspaceId: 'cms', actorId: 'editor', capabilities: ['conversations:read', 'conversations:write', 'skills:write', 'tools:approve'] };
export class TestClock implements Clock {
    time = Date.parse('2026-09-30T00:00:00.000Z');
    private count = 0;
    now() { return this.time; }
    id(prefix: string) { return `${prefix}_${String(++this.count).padStart(8, '0')}`; }
    advance(ms: number) { this.time += ms; }
}
export async function createLab(options: {
    repository?: Repository;
    host?: DemoHost;
    principal?: Principal;
    clock?: Clock;
} = {}) {
    const repository = options.repository ?? new MemoryRepository();
    const clock = options.clock ?? new TestClock();
    const principal = options.principal ?? DEMO_PRINCIPAL;
    const host = options.host ?? new DemoHost();
    const provider = new FakeProvider();
    const client = new ConversationService(repository, principal, host, clock);
    const runtime = new ExecutionRuntime(repository, host, provider, async () => principal, clock);
    const scope = await client.scope();
    for (const [skillId, name, body] of [
        ['writing', 'Writing guidelines', '# Writing guidelines\n\nUse direct language. Describe only supplied facts. Save drafts, never publish automatically.'],
        ['review', 'Review changes', '# Review changes\n\nShow the exact candidate and its base revision. A skill cannot grant tool permissions.'],
    ]) {
        if ((await repository.versions(scope.id, skillId!)).length)
            continue;
        await repository.appendSkill({ scope, actorId: principal.actorId, skill: { id: skillId!, name: name!, description: 'Versioned instructions, pinned when a run is accepted.', headVersion: 0 }, expectedHead: 0, revision: { skillId: skillId!, version: 1, body: body!, bodyHash: await sha256(body!), note: 'Initial demo instructions', createdAt: iso(clock), restoredFromVersion: null }, receipt: null });
    }
    const pending: WorkItem[] = [];
    async function dispatch() { return dispatchOutbox(repository, { async send(item) { pending.push(item); } }, clock); }
    async function pump() {
        // A bounded local worker loop. No browser connection is involved in the SQL server.
        let count = 0;
        await dispatch();
        while (pending.length && count < 30) {
            await runtime.deliver(pending.shift()!);
            count++;
            await dispatch();
        }
        return count;
    }
    return { repository, clock, principal, host, provider, client, runtime, scope, pending, dispatch, pump };
}
