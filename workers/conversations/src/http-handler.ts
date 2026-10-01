import type { CommandOptions, ErrorCode, Principal, Result } from '../../../packages/core/src/domain.js';
import type { ConversationClient } from '../../../packages/client/src/port.js';
import { readBoundedJson } from '../../../packages/client/src/wire.js';
import { DomainError, failed, id, integer, invalid, LIMITS, object, requestKey } from '../../../packages/core/src/validation.js';
const STATUS: Record<ErrorCode, number> = {
    NOT_FOUND: 404, UNAUTHENTICATED: 401, FORBIDDEN: 403, INVALID_REQUEST: 400,
    RUN_IN_PROGRESS: 409, CONVERSATION_ARCHIVED: 409, STALE_REVISION: 409,
    STALE_PROPOSAL: 409, PROPOSAL_NOT_PENDING: 409, IDEMPOTENCY_CONFLICT: 409,
    CURSOR_INVALID: 400, RESYNC_REQUIRED: 409, QUOTA_EXCEEDED: 429,
    PROVIDER_UNAVAILABLE: 503, TOOL_RESULT_UNKNOWN: 409, ASSISTANT_DISABLED: 503, SERVICE_UNAVAILABLE: 503,
};
function response(result: Result<unknown>, successStatus = 200): Response {
    return Response.json(result, { status: result.ok ? successStatus : STATUS[result.error.code], headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function query(url: URL, allowed: string[]) {
    for (const key of url.searchParams.keys())
        if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
            invalid('Invalid or repeated query parameter.');
    return url.searchParams;
}
/** Host-authenticated boundary. No client actor/scope fields and no built-in dev identity. */
export function createHandler(options: {
    resolvePrincipal(request: Request): Promise<Principal | null>;
    client(principal: Principal): ConversationClient;
    enabled?: () => boolean;
}) {
    return async (request: Request): Promise<Response> => {
        const requestId = `req_${crypto.randomUUID().replaceAll('-', '')}`;
        try {
            if (options.enabled && !options.enabled())
                throw new DomainError('ASSISTANT_DISABLED', 'Assistant is disabled.');
            const principal = await options.resolvePrincipal(request);
            if (!principal)
                throw new DomainError('UNAUTHENTICATED', 'Authentication is required.');
            const url = new URL(request.url);
            const method = request.method;
            if (!url.pathname.startsWith('/api/v1/'))
                throw new DomainError('NOT_FOUND', 'Route not found.');
            let path: string[];
            try {
                path = url.pathname.slice('/api/v1/'.length).split('/').map(decodeURIComponent);
            }
            catch {
                invalid('Invalid path encoding.');
            }
            if (path.some(p => !p))
                throw new DomainError('NOT_FOUND', 'Route not found.');
            const c = options.client(principal);
            let body: Record<string, unknown> = {};
            let command: CommandOptions = { requestKey: '' };
            if (method !== 'GET') {
                const origin = request.headers.get('origin');
                if (origin && origin !== url.origin)
                    throw new DomainError('FORBIDDEN', 'Cross-origin mutations are not permitted.');
                if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
                    invalid('Use application/json.');
                command = { requestKey: requestKey(request.headers.get('idempotency-key')) };
                try {
                    body = object(await readBoundedJson(request.body, LIMITS.bodyBytes), ['title', 'archived', 'expectedRevision', 'text', 'decision', 'payloadHash', 'expectedHead', 'body', 'note', 'sourceVersion']);
                }
                catch {
                    invalid('Invalid or oversized JSON request.');
                }
            }
            if (path[0] === 'conversations') {
                if (path.length === 1) {
                    if (method === 'GET') {
                        const q = query(url, ['archived', 'search', 'cursor']);
                        if (q.has('archived') && !['true', 'false'].includes(q.get('archived')!))
                            invalid();
                        return response(await c.list({ ...(q.has('archived') ? { archived: q.get('archived') === 'true' } : {}), ...(q.has('search') ? { search: q.get('search')! } : {}), ...(q.has('cursor') ? { cursor: q.get('cursor')! } : {}) }));
                    }
                    query(url, []);
                    if (method === 'POST')
                        return response(await c.create(body as {
                            title?: string;
                        }, command), 201);
                }
                const cid = id(path[1]);
                if (path.length === 2) {
                    query(url, []);
                    if (method === 'GET')
                        return response(await c.snapshot(cid));
                    if (method === 'PATCH')
                        return response(await c.update(cid, body as Parameters<ConversationClient['update']>[1], command));
                }
                if (path.length === 3) {
                    if (path[2] === 'events' && method === 'GET') {
                        const q = query(url, ['after']);
                        const value = q.get('after') ?? '0';
                        if (!/^(0|[1-9][0-9]*)$/.test(value))
                            invalid();
                        return response(await c.events(cid, integer(Number(value))));
                    }
                    if (path[2] === 'messages' && method === 'GET') {
                        const q = query(url, ['before']);
                        return response(await c.history(cid, id(q.get('before'))));
                    }
                    query(url, []);
                    if (path[2] === 'messages' && method === 'POST')
                        return response(await c.send(cid, body as Parameters<ConversationClient['send']>[1], command), 202);
                    if (path[2] === 'export' && method === 'GET')
                        return response(await c.export(cid));
                }
                if (path.length === 5) {
                    query(url, []);
                    const rid = id(path[3]);
                    if (path[2] === 'runs') {
                        if (path[4] === 'context' && method === 'GET')
                            return response(await c.context(cid, rid));
                        object(body, []);
                        if (path[4] === 'cancel' && method === 'POST')
                            return response(await c.cancel(cid, rid, command), 202);
                        if (path[4] === 'retry' && method === 'POST')
                            return response(await c.retry(cid, rid, command), 202);
                    }
                    if (path[2] === 'proposals') {
                        if (path[4] === 'decision' && method === 'POST')
                            return response(await c.decide(cid, rid, body as Parameters<ConversationClient['decide']>[2], command), 202);
                        object(body, []);
                        if (path[4] === 'refresh' && method === 'POST')
                            return response(await c.refreshProposal(cid, rid, command), 202);
                    }
                }
            }
            if (path[0] === 'skills') {
                if (path.length === 1 && method === 'GET') {
                    query(url, []);
                    return response(await c.skills());
                }
                const sid = id(path[1]);
                if (path.length === 3 && path[2] === 'versions') {
                    if (method === 'GET') {
                        const q = query(url, ['cursor']);
                        return response(await c.skillHistory(sid, q.get('cursor') ?? undefined));
                    }
                    query(url, []);
                    if (method === 'POST')
                        return response(await c.saveSkill(sid, body as Parameters<ConversationClient['saveSkill']>[1], command), 201);
                }
                query(url, []);
                if (path.length === 3 && path[2] === 'restore' && method === 'POST')
                    return response(await c.restoreSkill(sid, body as Parameters<ConversationClient['restoreSkill']>[1], command), 201);
            }
            throw new DomainError('NOT_FOUND', 'Route not found.');
        }
        catch (error) {
            if (error instanceof DomainError)
                return response(failed(error, requestId));
            // Never expose database/provider exceptions, raw bodies, credentials, or stack traces.
            return response(failed(new DomainError('SERVICE_UNAVAILABLE', 'The service could not complete the request. Retain its idempotency key.', true), requestId));
        }
    };
}
