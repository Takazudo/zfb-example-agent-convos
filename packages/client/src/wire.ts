import type { AcceptedRun, ContextView, Conversation, EventPage, Message, Proposal, Result, Run, SkillRevision, Snapshot } from '../../core/src/domain.js';
import { asJson, bool, hash, id, integer, object, text } from '../../core/src/validation.js';
export class TransportError extends Error {
    constructor(public readonly kind: 'network' | 'protocol' | 'aborted', message: string) { super(message); this.name = 'TransportError'; }
}
export type Decoder<T> = (value: unknown) => T;
type Schema = (value: unknown) => unknown;
const str: Schema = v => text(v, 1048576, 0);
const date: Schema = v => { const s = str(v) as string; if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) || !Number.isFinite(Date.parse(s)))
    throw new Error('Invalid date'); return s; };
const nullable = (schema: Schema): Schema => v => v === null ? null : schema(v);
const num: Schema = v => integer(v);
const positive: Schema = v => integer(v, 1);
const oneOf = (...values: unknown[]): Schema => v => { if (!values.includes(v))
    throw new Error('Unsupported discriminant'); return v; };
const array = (schema: Schema, max = 1000): Schema => v => {
    if (!Array.isArray(v) || v.length > max)
        throw new Error('Invalid array');
    return v.map(schema);
};
const record = (shape: Record<string, Schema>): Schema => value => {
    const r = object(value, Object.keys(shape));
    const result: Record<string, unknown> = {};
    for (const [k, schema] of Object.entries(shape))
        result[k] = schema(r[k]);
    return result;
};
const as = <T,>(schema: Schema): Decoder<T> => value => {
    try {
        return schema(value) as T;
    }
    catch {
        throw new TransportError('protocol', 'The API returned an unsupported response shape.');
    }
};
const errors = oneOf('NOT_FOUND', 'UNAUTHENTICATED', 'FORBIDDEN', 'INVALID_REQUEST', 'RUN_IN_PROGRESS', 'CONVERSATION_ARCHIVED', 'STALE_REVISION', 'STALE_PROPOSAL', 'PROPOSAL_NOT_PENDING', 'IDEMPOTENCY_CONFLICT', 'CURSOR_INVALID', 'RESYNC_REQUIRED', 'QUOTA_EXCEEDED', 'PROVIDER_UNAVAILABLE', 'TOOL_RESULT_UNKNOWN', 'ASSISTANT_DISABLED', 'SERVICE_UNAVAILABLE');
const runStatus = oneOf('queued', 'running', 'awaiting_approval', 'applying', 'cancel_requested', 'needs_reconciliation', 'completed', 'failed', 'cancelled', 'conflicted');
const pin = record({ skillId: id, version: positive, bodyHash: hash });
const conversationSchema = record({ id, title: str, archived: bool, revision: positive, lastEventSeq: num, createdAt: date, updatedAt: date, activeRun: nullable(record({ id, status: runStatus })) });
const messageSchema = record({ id, conversationId: id, runId: nullable(id), role: oneOf('user', 'assistant'), parts: array(record({ type: oneOf('text'), text: str }), 100), state: oneOf('accepted', 'streaming', 'complete', 'partial'), createdSeq: positive, createdAt: date });
const runSchema = record({ id, conversationId: id, inputMessageId: id, contextSnapshotId: id, status: runStatus, revision: positive, retryOfRunId: nullable(id), refreshOfProposalId: nullable(id), skillPins: array(pin, 100), createdAt: date, updatedAt: date, outcome: nullable(oneOf('read_only', 'applied', 'rejected')), error: nullable(record({ code: errors, safeMessage: str, retryable: bool })) });
const proposalSchema = record({ id, conversationId: id, runId: id, status: oneOf('pending', 'approved', 'applied', 'rejected', 'stale', 'unknown'), payloadHash: hash, action: record({ toolId: id, toolVersion: str, resourceId: id, args: asJson }), baseRevision: nullable(str), display: record({ title: str, path: str, before: nullable(str), after: str }), createdAt: date });
const skillSchema = record({ skillId: id, version: positive, body: str, bodyHash: hash, note: str, createdAt: date, restoredFromVersion: nullable(positive) });
const snapshotSchema = record({ conversation: conversationSchema, messages: array(messageSchema), runs: array(runSchema), proposals: array(proposalSchema), throughEventSeq: num, nextMessagePage: nullable(id) });
export const decode = {
    conversation: as<Conversation>(conversationSchema), message: as<Message>(messageSchema), run: as<Run>(runSchema), proposal: as<Proposal>(proposalSchema), skill: as<SkillRevision>(skillSchema),
    accepted: as<AcceptedRun>(record({ conversationId: id, runId: id, messageId: id, acceptedSeq: positive })),
    list: as<{
        items: Conversation[];
        nextCursor: string | null;
    }>(record({ items: array(conversationSchema, 50), nextCursor: nullable(id) })),
    history: as<{
        messages: Message[];
        nextCursor: string | null;
    }>(record({ messages: array(messageSchema, 50), nextCursor: nullable(id) })),
    skills: as<Array<{
        id: string;
        name: string;
        description: string;
        headVersion: number;
    }>>(array(record({ id, name: str, description: str, headVersion: positive }), 100)),
    versions: as<{
        items: SkillRevision[];
        nextCursor: string | null;
    }>(record({ items: array(skillSchema, 50), nextCursor: nullable(str) })),
    context: as<ContextView>(record({ snapshotId: id, throughEventSeq: num, skillPins: array(pin, 100), selectedMessageIds: array(id), summaryThroughEventSeq: nullable(num), cache: record({ application: oneOf('hit', 'miss', 'disabled'), provider: oneOf('hit', 'miss', 'unknown') }) })),
    snapshot: (value: unknown): Snapshot => {
        const x = as<Snapshot>(snapshotSchema)(value);
        if (x.throughEventSeq !== x.conversation.lastEventSeq || [...x.messages, ...x.runs, ...x.proposals].some(i => i.conversationId !== x.conversation.id))
            throw new TransportError('protocol', 'Snapshot identities or cursor do not agree.');
        for (const rows of [x.messages, x.runs, x.proposals])
            if (new Set(rows.map(r => r.id)).size !== rows.length)
                throw new TransportError('protocol', 'Snapshot contains duplicate entity IDs.');
        return x;
    },
    events: (value: unknown): EventPage => {
        const event: Schema = value => {
            const r = object(value, ['schemaVersion', 'conversationId', 'seq', 'at', 'type', 'payload']);
            const payloads: Record<string, Schema> = { 'conversation.upsert': conversationSchema, 'message.upsert': messageSchema, 'run.upsert': runSchema, 'proposal.upsert': proposalSchema, 'tool.receipt': record({ effectKey: id, proposalId: id, outcome: oneOf('succeeded', 'failed', 'unknown'), safeSummary: str }) };
            if (typeof r.type !== 'string' || !Object.hasOwn(payloads, r.type))
                throw new Error('Unknown event');
            return record({ schemaVersion: oneOf(1), conversationId: id, seq: positive, at: date, type: oneOf(r.type), payload: payloads[r.type]! })(value);
        };
        return as<EventPage>(record({ events: array(event, 100), nextCursor: num, hasMore: bool }))(value);
    },
    export: (value: unknown): {
        schemaVersion: 1;
        snapshot: Snapshot;
    } => {
        const r = object(value, ['schemaVersion', 'snapshot']);
        if (r.schemaVersion !== 1)
            throw new TransportError('protocol', 'Unsupported export version.');
        return { schemaVersion: 1, snapshot: decode.snapshot(r.snapshot) };
    },
};
export function result<T>(value: unknown, decoder: Decoder<T>): Result<T> {
    try {
        const r = object(value, ['ok', 'value', 'error', 'requestId']);
        id(r.requestId);
        if (r.ok === true && !Object.hasOwn(r, 'error'))
            return { ok: true, value: decoder(r.value), requestId: r.requestId as string };
        if (r.ok === false && !Object.hasOwn(r, 'value'))
            return as<Result<T>>(record({ ok: oneOf(false), error: record({ code: errors, message: str, retryable: bool }), requestId: id }))(value);
        throw new Error('Invalid result discriminant');
    }
    catch (error) {
        if (error instanceof TransportError)
            throw error;
        throw new TransportError('protocol', 'The API returned an invalid envelope.');
    }
}
/** Bounded reader shared by ingress and egress. Do not call .json() on unbounded input. */
export async function readBoundedJson(body: ReadableStream<Uint8Array> | null, limit: number): Promise<unknown> {
    if (!body)
        throw new TransportError('protocol', 'Missing JSON body.');
    const reader = body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > limit) {
                await reader.cancel();
                throw new TransportError('protocol', 'JSON exceeds the configured byte limit.');
            }
            parts.push(value);
        }
        const merged = new Uint8Array(size);
        let at = 0;
        for (const p of parts) {
            merged.set(p, at);
            at += p.length;
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged));
    }
    finally {
        reader.releaseLock();
    }
}
