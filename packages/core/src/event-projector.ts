import type { Conversation, ConversationEvent, Message, Proposal, Run, Snapshot } from './domain.js';
export interface Projection {
    conversation: Conversation;
    cursor: number;
    messages: Record<string, Message>;
    runs: Record<string, Run>;
    proposals: Record<string, Proposal>;
    receiptKeys: ReadonlySet<string>;
}
export function fromSnapshot(snapshot: Snapshot): Projection {
    return {
        conversation: snapshot.conversation, cursor: snapshot.throughEventSeq,
        messages: Object.fromEntries(snapshot.messages.map(m => [m.id, m])),
        runs: Object.fromEntries(snapshot.runs.map(r => [r.id, r])),
        proposals: Object.fromEntries(snapshot.proposals.map(p => [p.id, p])),
        receiptKeys: new Set(),
    };
}
/** Discard exact/older deliveries; fail closed on gaps and wrong conversation.
 * A gap needs another page or fresh consistent snapshot, not guessed state.
 */
export function applyEvent(state: Projection, event: ConversationEvent): Projection {
    if (event.schemaVersion !== 1)
        throw new Error('VERSION_UNSUPPORTED');
    if (event.conversationId !== state.conversation.id)
        throw new Error('WRONG_CONVERSATION');
    if (!Number.isSafeInteger(event.seq) || event.seq < 1)
        throw new Error('INVALID_SEQUENCE');
    if (event.seq <= state.cursor)
        return state;
    if (event.seq !== state.cursor + 1)
        throw new Error('EVENT_GAP');
    const next: Projection = { ...state, cursor: event.seq };
    switch (event.type) {
        case 'conversation.upsert':
            if (event.payload.id !== event.conversationId)
                throw new Error('WRONG_CONVERSATION');
            next.conversation = event.payload;
            break;
        case 'message.upsert':
            if (event.payload.conversationId !== event.conversationId)
                throw new Error('WRONG_CONVERSATION');
            next.messages = { ...state.messages, [event.payload.id]: event.payload };
            break;
        case 'run.upsert':
            if (event.payload.conversationId !== event.conversationId)
                throw new Error('WRONG_CONVERSATION');
            next.runs = { ...state.runs, [event.payload.id]: event.payload };
            break;
        case 'proposal.upsert':
            if (event.payload.conversationId !== event.conversationId)
                throw new Error('WRONG_CONVERSATION');
            next.proposals = { ...state.proposals, [event.payload.id]: event.payload };
            break;
        case 'tool.receipt':
            next.receiptKeys = new Set([...state.receiptKeys, event.payload.effectKey]);
            break;
    }
    return next;
}
