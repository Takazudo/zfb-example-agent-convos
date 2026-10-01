import type { ConversationClient } from '../../client/src/port.js';
import type { Conversation, Message, Proposal, Result, Run } from '../../core/src/domain.js';
import { applyEvent, fromSnapshot, type Projection } from '../../core/src/event-projector.js';
import { TransportError } from '../../client/src/wire.js';
import { clone, id, integer, LIMITS, object, requestKey, hash, text } from '../../core/src/validation.js';
export interface StoragePort {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
}
export class MemoryStorage implements StoragePort {
    private values = new Map<string, string>();
    get(key: string) { return this.values.get(key) ?? null; }
    set(key: string, value: string) { this.values.set(key, value); }
    remove(key: string) { this.values.delete(key); }
}
type Pending = {
    kind: 'send';
    key: string;
    cid: string;
    input: {
        text: string;
        expectedRevision: number;
    };
} | {
    kind: 'update';
    key: string;
    cid: string;
    input: {
        expectedRevision: number;
        title?: string;
        archived?: boolean;
    };
} | {
    kind: 'decide';
    key: string;
    cid: string;
    pid: string;
    input: {
        decision: 'approve' | 'reject';
        payloadHash: string;
    };
} | {
    kind: 'cancel' | 'retry';
    key: string;
    cid: string;
    rid: string;
} | {
    kind: 'refresh';
    key: string;
    cid: string;
    pid: string;
};
export interface ViewState {
    conversations: Conversation[];
    selectedId: string | null;
    projection: Projection | null;
    draft: string;
    loading: boolean;
    busy: boolean;
    error: string | null;
    connection: 'connecting' | 'connected' | 'disconnected';
    archived: boolean;
    pending: {
        kind: Pending['kind'];
        requestKey: string;
    } | null;
    nextMessagePage: string | null;
    storageAvailable: boolean;
}
const initial = (): ViewState => ({ conversations: [], selectedId: null, projection: null, draft: '', loading: false, busy: false, error: null, connection: 'connecting', archived: false, pending: null, nextMessagePage: null, storageAvailable: true });
const unwrap = <T,>(r: Result<T>): T => { if (!r.ok)
    throw new CommandFailure(r.error.code, r.error.message); return r.value; };
class CommandFailure extends Error {
    constructor(readonly code: string, message: string) { super(message); }
}
/** Browser-independent view controller. Only the client port knows where state lives. */
export class ConversationController {
    private value = initial();
    private listeners = new Set<(s: ViewState) => void>();
    private epoch = 0;
    private readAbort = new AbortController();
    private disposed = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private polling = false;
    private pending = new Map<string, Pending>();
    private busy = new Set<string>();
    private draftCache = new Map<string, string>();
    private initialDraft = '';
    private listEpoch = 0;
    private snapshotEpoch = 0;
    constructor(readonly client: ConversationClient, private readonly storage: StoragePort = new MemoryStorage(), private readonly makeKey = () => `cmd_${crypto.randomUUID().replaceAll('-', '')}`) { }
    get state(): ViewState { return this.value; }
    subscribe(fn: (state: ViewState) => void) { this.listeners.add(fn); fn(this.value); return () => { this.listeners.delete(fn); }; }
    private publish(patch: Partial<ViewState> = {}) {
        if (this.disposed)
            return;
        const cid = patch.selectedId === undefined ? this.value.selectedId : patch.selectedId;
        const pending = cid ? this.pending.get(cid) : null;
        this.value = { ...this.value, ...patch, busy: cid ? this.busy.has(cid) : false, pending: pending ? { kind: pending.kind, requestKey: pending.key } : null };
        // Replay updates the selected thread's sidebar summary as well as its transcript.
        // Otherwise a completed run can remain labelled Queued until a list refresh.
        if (patch.projection) {
            const conversation = patch.projection.conversation;
            this.value.conversations = this.value.conversations.map(item => item.id === conversation.id ? conversation : item);
        }
        for (const listener of this.listeners)
            listener(this.value);
    }
    private stored(key: string): string | null { try {
        return this.storage.get(key);
    }
    catch {
        this.publish({ storageAvailable: false });
        return null;
    } }
    private store(key: string, value: string | null) {
        try {
            if (value === null)
                this.storage.remove(key);
            else
                this.storage.set(key, value);
        }
        catch {
            this.publish({ storageAvailable: false });
        }
    }
    setDraft(value: string) {
        const cid = this.value.selectedId;
        if (cid) {
            this.draftCache.set(cid, value);
            this.store(`draft:${cid}`, value);
        }
        else
            this.initialDraft = value;
        this.publish({ draft: value });
    }
    async start(initialDraft = '') {
        this.initialDraft = initialDraft;
        await this.refreshList();
        if (!this.disposed && !this.value.selectedId && this.value.conversations[0])
            await this.select(this.value.conversations[0].id);
    }
    async refreshList(search = '') {
        const token = ++this.listEpoch;
        try {
            const r = unwrap(await this.client.list({ archived: this.value.archived, search }));
            if (!this.disposed && token === this.listEpoch)
                this.publish({ conversations: r.items });
        }
        catch (error) {
            if (!this.disposed && token === this.listEpoch)
                this.publish({ error: this.message(error) });
        }
    }
    async setArchived(value: boolean) { this.publish({ archived: value }); await this.refreshList(); }
    private loadPending(cid: string) {
        if (this.pending.has(cid))
            return;
        const raw = this.stored(`pending:${cid}`);
        if (!raw)
            return;
        try {
            if (raw.length > LIMITS.bodyBytes)
                throw new Error();
            const p = object(JSON.parse(raw), ['kind', 'key', 'cid', 'rid', 'pid', 'input']);
            if (id(p.cid) !== cid)
                throw new Error();
            requestKey(p.key);
            if (p.kind === 'send') {
                object(p, ['kind', 'key', 'cid', 'input']);
                const input = object(p.input, ['text', 'expectedRevision']);
                text(input.text, LIMITS.inputBytes);
                integer(input.expectedRevision);
            }
            else if (p.kind === 'update') {
                object(p, ['kind', 'key', 'cid', 'input']);
                const input = object(p.input, ['title', 'archived', 'expectedRevision']);
                integer(input.expectedRevision);
                if (input.title !== undefined)
                    text(input.title, LIMITS.title * 4);
                if (input.archived !== undefined && typeof input.archived !== 'boolean')
                    throw new Error();
                if (input.title === undefined && input.archived === undefined)
                    throw new Error();
            }
            else if (p.kind === 'decide') {
                object(p, ['kind', 'key', 'cid', 'pid', 'input']);
                id(p.pid);
                const input = object(p.input, ['decision', 'payloadHash']);
                hash(input.payloadHash);
                if (input.decision !== 'approve' && input.decision !== 'reject')
                    throw new Error();
            }
            else if (p.kind === 'retry' || p.kind === 'cancel') {
                object(p, ['kind', 'key', 'cid', 'rid']);
                id(p.rid);
            }
            else if (p.kind === 'refresh') {
                object(p, ['kind', 'key', 'cid', 'pid']);
                id(p.pid);
            }
            else
                throw new Error();
            this.pending.set(cid, p as unknown as Pending);
        }
        catch {
            this.store(`pending:${cid}`, null);
        }
    }
    async select(cid: string) {
        if (this.disposed)
            return;
        this.readAbort.abort();
        this.readAbort = new AbortController();
        const epoch = ++this.epoch;
        this.loadPending(cid);
        const draft = this.initialDraft || (this.draftCache.get(cid) ?? this.stored(`draft:${cid}`) ?? '');
        this.initialDraft = '';
        this.draftCache.set(cid, draft);
        this.publish({ selectedId: cid, projection: null, draft, loading: true, error: null, connection: 'connecting', nextMessagePage: null });
        await this.loadSnapshot(cid, epoch);
    }
    private async loadSnapshot(cid: string, epoch: number) {
        const requestEpoch = ++this.snapshotEpoch;
        try {
            const snapshot = unwrap(await this.client.snapshot(cid, this.readAbort.signal));
            if (this.disposed || epoch !== this.epoch || cid !== this.value.selectedId || requestEpoch !== this.snapshotEpoch)
                return;
            if (snapshot.conversation.id !== cid)
                throw new TransportError('protocol', 'Wrong conversation returned by the API.');
            const current = this.value.projection;
            if (current && current.cursor > snapshot.throughEventSeq)
                return;
            const projection = fromSnapshot(snapshot);
            if (current?.conversation.id === cid)
                projection.messages = { ...current.messages, ...projection.messages };
            this.publish({ projection, nextMessagePage: snapshot.nextMessagePage, loading: false, connection: 'connected', error: null });
        }
        catch (error) {
            if (!this.disposed && epoch === this.epoch && requestEpoch === this.snapshotEpoch && !this.readAbort.signal.aborted)
                this.publish({ loading: false, connection: 'disconnected', error: this.message(error) });
        }
    }
    async refresh() {
        const cid = this.value.selectedId;
        if (cid)
            await this.loadSnapshot(cid, this.epoch);
        await this.refreshList();
    }
    async poll() {
        const cid = this.value.selectedId;
        const epoch = this.epoch;
        if (this.disposed || this.polling || !cid || !this.value.projection)
            return;
        this.polling = true;
        try {
            let projection = this.value.projection;
            for (let pageCount = 0; pageCount < 20; pageCount++) {
                const page = unwrap(await this.client.events(cid, projection.cursor, this.readAbort.signal));
                if (this.disposed || epoch !== this.epoch)
                    return;
                if (page.nextCursor !== (page.events.at(-1)?.seq ?? projection.cursor) || (page.hasMore && !page.events.length))
                    throw new TransportError('protocol', 'Invalid event-page cursor.');
                if (this.value.projection && this.value.projection.cursor > projection.cursor)
                    projection = this.value.projection;
                for (const event of page.events)
                    projection = applyEvent(projection, event);
                this.publish({ projection, connection: 'connected', ...(this.value.connection === 'disconnected' ? { error: null } : {}) });
                if (!page.hasMore)
                    break;
            }
        }
        catch (error) {
            if (this.disposed || epoch !== this.epoch || this.readAbort.signal.aborted)
                return;
            if (error instanceof CommandFailure && ['RESYNC_REQUIRED', 'CURSOR_INVALID'].includes(error.code) || error instanceof Error && error.message === 'EVENT_GAP')
                await this.loadSnapshot(cid, epoch);
            else
                this.publish({ connection: 'disconnected', error: this.message(error) });
        }
        finally {
            this.polling = false;
        }
    }
    startPolling(interval = 400) {
        const loop = async () => {
            if (this.disposed)
                return;
            await this.poll();
            if (!this.disposed)
                this.timer = setTimeout(loop, this.value.connection === 'disconnected' ? Math.max(1500, interval) : interval);
        };
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.timer = setTimeout(loop, interval);
    }
    async older() {
        const cid = this.value.selectedId;
        const cursor = this.value.nextMessagePage;
        const epoch = this.epoch;
        if (!cid || !cursor || !this.value.projection)
            return;
        try {
            const page = unwrap(await this.client.history(cid, cursor, this.readAbort.signal));
            if (epoch !== this.epoch || this.disposed || !this.value.projection)
                return;
            if (page.messages.some(m => m.conversationId !== cid))
                throw new TransportError('protocol', 'Wrong conversation in message history.');
            this.publish({ projection: { ...this.value.projection, messages: { ...Object.fromEntries(page.messages.map(m => [m.id, m])), ...this.value.projection.messages } }, nextMessagePage: page.nextCursor });
        }
        catch (error) {
            if (epoch === this.epoch)
                this.publish({ error: this.message(error) });
        }
    }
    private message(error: unknown): string { return error instanceof CommandFailure || error instanceof TransportError ? error.message : 'The operation could not complete. Your draft is retained.'; }
    private async execute(p: Pending): Promise<void> {
        if (this.busy.has(p.cid))
            return;
        this.pending.set(p.cid, clone(p));
        this.store(`pending:${p.cid}`, JSON.stringify(p));
        this.busy.add(p.cid);
        this.publish({ error: null });
        try {
            const options = { requestKey: p.key };
            let r: Result<unknown>;
            switch (p.kind) {
                case 'send':
                    r = await this.client.send(p.cid, p.input, options);
                    break;
                case 'update':
                    r = await this.client.update(p.cid, p.input, options);
                    break;
                case 'decide':
                    r = await this.client.decide(p.cid, p.pid, p.input, options);
                    break;
                case 'cancel':
                    r = await this.client.cancel(p.cid, p.rid, options);
                    break;
                case 'retry':
                    r = await this.client.retry(p.cid, p.rid, options);
                    break;
                case 'refresh':
                    r = await this.client.refreshProposal(p.cid, p.pid, options);
                    break;
            }
            unwrap(r);
            this.pending.delete(p.cid);
            this.store(`pending:${p.cid}`, null);
            if (p.kind === 'send' && this.draftCache.get(p.cid) === p.input.text) {
                this.draftCache.set(p.cid, '');
                this.store(`draft:${p.cid}`, '');
                if (this.value.selectedId === p.cid)
                    this.publish({ draft: '' });
            }
            if (this.value.selectedId === p.cid)
                await this.loadSnapshot(p.cid, this.epoch);
            await this.refreshList();
        }
        catch (error) {
            // Explicit server rejection is determinate. Transport errors are ambiguous: keep the key/body.
            if (error instanceof CommandFailure) {
                this.pending.delete(p.cid);
                this.store(`pending:${p.cid}`, null);
            }
            if (this.value.selectedId === p.cid)
                this.publish({ error: this.message(error) });
        }
        finally {
            this.busy.delete(p.cid);
            this.publish();
        }
    }
    private ready(): {
        cid: string;
        revision: number;
    } | null {
        const cid = this.value.selectedId;
        const projection = this.value.projection;
        if (!cid || !projection || this.pending.has(cid) || this.busy.has(cid) || this.disposed)
            return null;
        return { cid, revision: projection.conversation.revision };
    }
    async send() {
        const r = this.ready();
        if (!r || !this.value.draft.trim())
            return;
        try {
            text(this.value.draft, LIMITS.inputBytes);
        }
        catch {
            this.publish({ error: 'Message exceeds the 16 KiB UTF-8 limit.' });
            return;
        }
        await this.execute({ kind: 'send', cid: r.cid, key: this.makeKey(), input: { text: this.value.draft, expectedRevision: r.revision } });
    }
    async retryPending() { const cid = this.value.selectedId; const p = cid ? this.pending.get(cid) : null; if (p)
        await this.execute(p); }
    async update(input: {
        title?: string;
        archived?: boolean;
    }) { const r = this.ready(); if (r)
        await this.execute({ kind: 'update', cid: r.cid, key: this.makeKey(), input: { ...input, expectedRevision: r.revision } }); }
    async decide(proposal: Proposal, decision: 'approve' | 'reject') {
        const r = this.ready();
        if (r && proposal.conversationId === r.cid)
            await this.execute({ kind: 'decide', cid: r.cid, pid: proposal.id, key: this.makeKey(), input: { decision, payloadHash: proposal.payloadHash } });
    }
    async cancel(run: Run) { const r = this.ready(); if (r && run.conversationId === r.cid)
        await this.execute({ kind: 'cancel', cid: r.cid, rid: run.id, key: this.makeKey() }); }
    async retry(run: Run) { const r = this.ready(); if (r && run.conversationId === r.cid)
        await this.execute({ kind: 'retry', cid: r.cid, rid: run.id, key: this.makeKey() }); }
    async refreshProposal(p: Proposal) { const r = this.ready(); if (r && p.conversationId === r.cid)
        await this.execute({ kind: 'refresh', cid: r.cid, pid: p.id, key: this.makeKey() }); }
    async create(title = 'New conversation') {
        // Creation uses a per-attempt persisted receipt just like other commands.
        const raw = this.stored('create-pending');
        let input = { title };
        let key = this.makeKey();
        if (raw) {
            try {
                const p = JSON.parse(raw);
                if (typeof p.key === 'string' && typeof p.title === 'string') {
                    key = p.key;
                    input = { title: p.title };
                }
            }
            catch { /* replace invalid local state */ }
        }
        this.store('create-pending', JSON.stringify({ key, ...input }));
        try {
            const c = unwrap(await this.client.create(input, { requestKey: key }));
            this.store('create-pending', null);
            await this.refreshList();
            if (!this.disposed)
                await this.select(c.id);
        }
        catch (error) {
            if (error instanceof CommandFailure)
                this.store('create-pending', null);
            this.publish({ error: this.message(error) });
        }
    }
    dispose() {
        this.disposed = true;
        this.epoch++;
        this.listEpoch++;
        this.readAbort.abort();
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.listeners.clear();
        // This cancels local reads only. It intentionally sends no run-cancellation command.
    }
}
/** Enter confirms IME text instead of sending it. Shift+Enter remains a native newline. */
export function shouldSendOnEnter(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing' | 'keyCode'>, composing: boolean): boolean {
    return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !composing;
}
export function orderedMessages(projection: Projection | null): Message[] {
    return projection ? Object.values(projection.messages).sort((a, b) => a.createdSeq - b.createdSeq || a.id.localeCompare(b.id)) : [];
}

/** Prefer the active run; terminal chronology follows the user-turn sequence and retry/refresh ancestry.
 * ISO timestamps alone are insufficient when two commands share one millisecond and IDs are random.
 */
export function latestRun(projection: Projection | null): Run | undefined {
    if (!projection) return undefined;
    const activeId = projection.conversation.activeRun?.id;
    if (activeId && projection.runs[activeId]) return projection.runs[activeId];
    const superseded = new Set<string>();
    for (const run of Object.values(projection.runs)) {
        if (run.retryOfRunId) superseded.add(run.retryOfRunId);
        const proposal = run.refreshOfProposalId ? projection.proposals[run.refreshOfProposalId] : undefined;
        if (proposal) superseded.add(proposal.runId);
    }
    return Object.values(projection.runs).filter(run => !superseded.has(run.id)).sort((a, b) =>
        (projection.messages[a.inputMessageId]?.createdSeq ?? 0) - (projection.messages[b.inputMessageId]?.createdSeq ?? 0)
        || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).at(-1);
}
