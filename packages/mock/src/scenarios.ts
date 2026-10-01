import type { ConversationClient } from '../../client/src/port.js';
import type { Result } from '../../core/src/domain.js';
import { TransportError } from '../../client/src/wire.js';
import { createLab } from './lab.js';
export const SCENARIOS = ['Ready for review', 'Streaming response', 'Reconnect & replay', 'Stale proposal', 'Interrupted run', 'New conversation', 'Long history'] as const;
export type Scenario = typeof SCENARIOS[number];
const unwrap = <T,>(r: Result<T>): T => { if (!r.ok)
    throw new Error(r.error.message); return r.value; };
export async function createScenario(scenario: Scenario = 'Ready for review') {
    const lab = await createLab();
    for (const title of ['Inquiry email address', 'Company information'])
        unwrap(await lab.client.create({ title }, { requestKey: lab.clock.id('seed') }));
    const c = unwrap(await lab.client.create({ title: scenario === 'New conversation' ? 'New conversation' : 'October release page' }, { requestKey: 'seed-primary' }));
    if (scenario !== 'New conversation') {
        if (scenario === 'Interrupted run')
            lab.provider.mode = 'fail';
        const count = scenario === 'Long history' ? 27 : 1;
        if (count > 1)
            lab.provider.mode = 'read-only';
        for (let i = 0; i < count; i++) {
            const snapshot = unwrap(await lab.client.snapshot(c.id));
            unwrap(await lab.client.send(c.id, { text: count > 1 ? `Conversation note ${i + 1}: Keep the release plan as a draft.` : 'Create a release page for the October collection. Use the compact oscillator and updated guide we discussed. The release date is October 1. Keep it as a draft.', expectedRevision: snapshot.conversation.revision }, { requestKey: `seed-message-${i}` }));
            if (scenario !== 'Streaming response')
                await lab.pump();
        }
    }
    if (scenario === 'Stale proposal')
        await lab.host.externalChange(lab.principal);
    lab.provider.mode = 'review';
    lab.provider.delayMs = 250;
    let disposed = false;
    let pumping = false;
    let offline = false;
    async function pump() {
        if (disposed || pumping)
            return;
        pumping = true;
        try {
            await lab.pump();
        }
        finally {
            pumping = false;
        }
    }
    const mutating = new Set(['send', 'cancel', 'retry', 'decide', 'refreshProposal']);
    const methods: Array<keyof ConversationClient> = ['list', 'create', 'snapshot', 'events', 'history', 'export', 'update', 'send', 'cancel', 'retry', 'decide', 'refreshProposal', 'context', 'skills', 'skillHistory', 'saveSkill', 'restoreSkill'];
    const port: Record<string, unknown> = {};
    for (const method of methods)
        port[method] = async (...args: unknown[]) => {
            if (disposed)
                throw new TransportError('aborted', 'Demo session disposed.');
            if (offline)
                throw new TransportError('network', 'Demo connection interrupted. Reconnect to replay retained events.');
            const invoke = lab.client[method].bind(lab.client) as (...args: unknown[]) => Promise<Result<unknown>>;
            const r = await invoke(...args);
            if (r.ok && mutating.has(method))
                queueMicrotask(() => { void pump().catch(() => { }); });
            return r;
        };
    return {
        client: port as unknown as ConversationClient, selectedId: c.id,
        start() { if (scenario === 'Streaming response')
            void pump(); },
        setOffline(value: boolean) { offline = value; },
        readHost: () => lab.host.inspect(lab.principal, c.id),
        dispose() { disposed = true; },
    };
}
