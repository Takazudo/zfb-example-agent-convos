import type { Principal } from '../../../packages/core/src/domain.js';
import type { WorkItem } from '../../../packages/core/src/repository.js';
import { ConversationService, type Host, type Clock, iso, realClock } from '../../../packages/core/src/service.js';
import { id, integer, object, text } from '../../../packages/core/src/validation.js';
import { D1Repository, type D1Port } from './d1-repository.js';
import { createHandler } from './http-handler.js';
import { dispatchOutbox, ExecutionRuntime, type AuthorityResolver, type Provider, type QueuePort } from './execution.js';
export interface QueueMessage {
    body: unknown;
    ack(): void;
    retry(options?: {
        delaySeconds: number;
    }): void;
}
export interface QueueBatch {
    messages: QueueMessage[];
}
export interface WorkerOptions {
    database: D1Port;
    queue: QueuePort;
    host: Host;
    provider: Provider;
    authenticate(request: Request): Promise<Principal | null>;
    resolveAuthority: AuthorityResolver;
    /** Explicitly false by default; the consumer owns its kill switch and environment policy. */
    enabled?: () => boolean;
    clock?: Clock;
}
function work(value: unknown): WorkItem {
    const v = object(value, ['id', 'scopeId', 'conversationId', 'runId', 'kind', 'status', 'attempt', 'nextAttemptAt', 'createdAt']);
    id(v.id);
    id(v.scopeId);
    id(v.conversationId);
    id(v.runId);
    integer(v.attempt);
    if (!['generate', 'apply', 'reconcile'].includes(String(v.kind)) || !['pending', 'sent'].includes(String(v.status)))
        throw Error('Invalid queue item');
    for (const field of ['nextAttemptAt', 'createdAt']) {
        text(v[field], 40);
        if (!Number.isFinite(Date.parse(String(v[field]))))
            throw Error('Invalid queue timestamp');
    }
    return v as unknown as WorkItem;
}
/** Host-assembled Cloudflare-compatible handlers; no hard-coded principal, public endpoint, or env credential fallback. */
export function createConversationWorker(options: WorkerOptions) {
    const clock = options.clock ?? realClock;
    const enabled = options.enabled ?? (() => false);
    const repository = new D1Repository(options.database);
    const runtime = new ExecutionRuntime(repository, options.host, options.provider, options.resolveAuthority, clock);
    const fetch = createHandler({ enabled, resolvePrincipal: options.authenticate, client: p => new ConversationService(repository, p, options.host, clock) });
    return {
        fetch,
        async queue(batch: QueueBatch) {
            if (!enabled()) {
                for (const message of batch.messages)
                    message.retry({ delaySeconds: 60 });
                return;
            }
            for (const message of batch.messages) {
                let item: WorkItem;
                try {
                    item = work(message.body);
                }
                catch {
                    message.ack();
                    continue;
                }
                try {
                    await runtime.deliver(item);
                    message.ack();
                }
                catch {
                    message.retry({ delaySeconds: 30 });
                }
            }
        },
        async scheduled() {
            if (!enabled())
                return;
            await repository.repair(iso(clock));
            await dispatchOutbox(repository, options.queue, clock);
        },
    };
}
