import type { CommandOptions, Result } from '../../core/src/domain.js';
import type { ConversationClient } from './port.js';
import { decode, type Decoder, readBoundedJson, result, TransportError } from './wire.js';
import { id, requestKey } from '../../core/src/validation.js';
/** No implicit mutation retries. The caller retains the request key after an ambiguous failure. */
export class HttpConversationClient implements ConversationClient {
    constructor(readonly baseUrl = '/api/v1', private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {
        if (baseUrl.includes('?') || baseUrl.includes('#') || baseUrl.endsWith('/'))
            throw new Error('API base must have no query, hash, or trailing slash.');
    }
    private async call<T>(path: string, decoder: Decoder<T>, options: {
        method?: string;
        body?: unknown;
        command?: CommandOptions;
        signal?: AbortSignal;
    } = {}): Promise<Result<T>> {
        const signal = options.command?.signal ?? options.signal;
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (options.command)
            headers['Idempotency-Key'] = requestKey(options.command.requestKey);
        if (options.body !== undefined)
            headers['Content-Type'] = 'application/json';
        let response: Response;
        try {
            signal?.throwIfAborted();
            response = await this.fetcher(`${this.baseUrl}${path}`, { method: options.method ?? 'GET', headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), ...(signal ? { signal } : {}) });
        }
        catch {
            throw new TransportError(signal?.aborted ? 'aborted' : 'network', signal?.aborted ? 'Request wait was cancelled.' : 'The response was not received. Reuse the same request key when checking acceptance.');
        }
        if (!response.headers.get('content-type')?.includes('application/json'))
            throw new TransportError('protocol', 'Expected an API JSON response, not an HTML fallback.');
        try {
            const value = result(await readBoundedJson(response.body, 8388608), decoder);
            if (response.ok !== value.ok)
                throw new TransportError('protocol', 'HTTP status and response envelope disagree.');
            return value;
        }
        catch (error) {
            if (signal?.aborted)
                throw new TransportError('aborted', 'Request wait was cancelled.');
            if (error instanceof TransportError)
                throw error;
            throw new TransportError('protocol', 'The API response was not valid bounded JSON.');
        }
    }
    list(query: {
        archived?: boolean;
        search?: string;
        cursor?: string;
    }, signal?: AbortSignal) {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(query))
            if (v !== undefined)
                q.set(k, String(v));
        return this.call(`/conversations?${q}`, decode.list, signal ? { signal } : {});
    }
    create(input: {
        title?: string;
    }, command: CommandOptions) { return this.call('/conversations', decode.conversation, { method: 'POST', body: input, command }); }
    snapshot(cid: string, signal?: AbortSignal) { return this.call(`/conversations/${id(cid)}`, decode.snapshot, signal ? { signal } : {}); }
    history(cid: string, before: string, signal?: AbortSignal) { return this.call(`/conversations/${id(cid)}/messages?before=${id(before)}`, decode.history, signal ? { signal } : {}); }
    export(cid: string, signal?: AbortSignal) { return this.call(`/conversations/${id(cid)}/export`, decode.export, signal ? { signal } : {}); }
    events(cid: string, after: number, signal?: AbortSignal) { return this.call(`/conversations/${id(cid)}/events?after=${encodeURIComponent(String(after))}`, decode.events, signal ? { signal } : {}); }
    update(cid: string, input: {
        expectedRevision: number;
        title?: string;
        archived?: boolean;
    }, command: CommandOptions) { return this.call(`/conversations/${id(cid)}`, decode.conversation, { method: 'PATCH', body: input, command }); }
    send(cid: string, input: {
        text: string;
        expectedRevision: number;
    }, command: CommandOptions) { return this.call(`/conversations/${id(cid)}/messages`, decode.accepted, { method: 'POST', body: input, command }); }
    cancel(cid: string, rid: string, command: CommandOptions) { return this.call(`/conversations/${id(cid)}/runs/${id(rid)}/cancel`, decode.run, { method: 'POST', body: {}, command }); }
    retry(cid: string, rid: string, command: CommandOptions) { return this.call(`/conversations/${id(cid)}/runs/${id(rid)}/retry`, decode.accepted, { method: 'POST', body: {}, command }); }
    decide(cid: string, pid: string, input: {
        decision: 'approve' | 'reject';
        payloadHash: string;
    }, command: CommandOptions) { return this.call(`/conversations/${id(cid)}/proposals/${id(pid)}/decision`, decode.proposal, { method: 'POST', body: input, command }); }
    refreshProposal(cid: string, pid: string, command: CommandOptions) { return this.call(`/conversations/${id(cid)}/proposals/${id(pid)}/refresh`, decode.accepted, { method: 'POST', body: {}, command }); }
    context(cid: string, rid: string, signal?: AbortSignal) { return this.call(`/conversations/${id(cid)}/runs/${id(rid)}/context`, decode.context, signal ? { signal } : {}); }
    skills(signal?: AbortSignal) { return this.call('/skills', decode.skills, signal ? { signal } : {}); }
    skillHistory(sid: string, cursor?: string, signal?: AbortSignal) { return this.call(`/skills/${id(sid)}/versions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, decode.versions, signal ? { signal } : {}); }
    saveSkill(sid: string, input: {
        expectedHead: number;
        body: string;
        note: string;
    }, command: CommandOptions) { return this.call(`/skills/${id(sid)}/versions`, decode.skill, { method: 'POST', body: input, command }); }
    restoreSkill(sid: string, input: {
        expectedHead: number;
        sourceVersion: number;
    }, command: CommandOptions) { return this.call(`/skills/${id(sid)}/restore`, decode.skill, { method: 'POST', body: input, command }); }
}
