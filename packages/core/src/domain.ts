/** Wire contract v1. Framework- and provider-independent.
 * Validate these shapes at every trust boundary; TypeScript is not validation.
 */
export type Id = string;
export type ISODate = string;
export type Sha256 = string; // lowercase 64-hex; runtime validator required
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'applying' | 'cancel_requested' | 'needs_reconciliation' | 'completed' | 'failed' | 'cancelled' | 'conflicted';
export type ProposalStatus = 'pending' | 'approved' | 'applied' | 'rejected' | 'stale' | 'unknown';
export interface SkillPin {
    skillId: Id;
    version: number;
    bodyHash: Sha256;
}
export interface Conversation {
    id: Id;
    title: string;
    archived: boolean;
    revision: number;
    lastEventSeq: number;
    createdAt: ISODate;
    updatedAt: ISODate;
    activeRun: Pick<Run, 'id' | 'status'> | null;
}
export interface Message {
    id: Id;
    conversationId: Id;
    runId: Id | null;
    role: 'user' | 'assistant';
    parts: Array<{
        type: 'text';
        text: string;
    }>;
    state: 'accepted' | 'streaming' | 'complete' | 'partial';
    createdSeq: number;
    createdAt: ISODate;
}
export interface Run {
    id: Id;
    conversationId: Id;
    inputMessageId: Id;
    contextSnapshotId: Id;
    status: RunStatus;
    revision: number;
    retryOfRunId: Id | null;
    refreshOfProposalId: Id | null;
    skillPins: SkillPin[];
    createdAt: ISODate;
    updatedAt: ISODate;
    outcome: 'read_only' | 'applied' | 'rejected' | null;
    error: {
        code: ErrorCode;
        safeMessage: string;
        retryable: boolean;
    } | null;
}
export interface Proposal {
    id: Id;
    conversationId: Id;
    runId: Id;
    status: ProposalStatus;
    /** Hash covers the exact normalized action, tool version, and base revision. */
    payloadHash: Sha256;
    action: {
        toolId: Id;
        toolVersion: string;
        resourceId: Id;
        args: Json;
    };
    baseRevision: string | null; // null means expected absence, not “ignore current version”
    display: {
        title: string;
        path: string;
        before: string | null;
        after: string;
    };
    createdAt: ISODate;
}
export interface SkillRevision {
    skillId: Id;
    version: number;
    body: string;
    bodyHash: Sha256;
    note: string;
    createdAt: ISODate;
    restoredFromVersion: number | null;
}
export interface ContextView {
    snapshotId: Id;
    throughEventSeq: number;
    skillPins: SkillPin[];
    selectedMessageIds: Id[];
    summaryThroughEventSeq: number | null;
    /** Browser-safe metadata, not raw internal prompts or credentials. */
    cache: {
        application: 'hit' | 'miss' | 'disabled';
        provider: 'hit' | 'miss' | 'unknown';
    };
}
export interface Snapshot {
    conversation: Conversation;
    messages: Message[];
    runs: Run[];
    proposals: Proposal[]; /** Snapshot and cursor MUST represent one consistent cut. */
    throughEventSeq: number;
    nextMessagePage: string | null;
}
export type ErrorCode = 'NOT_FOUND' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_REQUEST' | 'RUN_IN_PROGRESS' | 'CONVERSATION_ARCHIVED' | 'STALE_REVISION' | 'STALE_PROPOSAL' | 'PROPOSAL_NOT_PENDING' | 'IDEMPOTENCY_CONFLICT' | 'CURSOR_INVALID' | 'RESYNC_REQUIRED' | 'QUOTA_EXCEEDED' | 'PROVIDER_UNAVAILABLE' | 'TOOL_RESULT_UNKNOWN' | 'ASSISTANT_DISABLED' | 'SERVICE_UNAVAILABLE';
export type Result<T> = {
    ok: true;
    value: T;
    requestId: Id;
} | {
    ok: false;
    error: {
        code: ErrorCode;
        message: string;
        retryable: boolean;
    };
    requestId: Id;
};
type EventData = {
    type: 'conversation.upsert';
    payload: Conversation;
} | {
    type: 'message.upsert';
    payload: Message;
} | {
    type: 'run.upsert';
    payload: Run;
} | {
    type: 'proposal.upsert';
    payload: Proposal;
} | {
    type: 'tool.receipt';
    payload: {
        effectKey: Id;
        proposalId: Id;
        outcome: 'succeeded' | 'failed' | 'unknown';
        safeSummary: string;
    };
};
/** Persist complete message parts at chunk checkpoints, not raw token deltas.
 * This makes replay idempotent and simplifies chunk loss recovery.
 */
export type ConversationEvent = EventData & {
    schemaVersion: 1;
    conversationId: Id;
    seq: number;
    at: ISODate;
};
export interface EventPage {
    events: ConversationEvent[];
    nextCursor: number; // last RETURNED event seq, not the server's latest if more pages remain
    hasMore: boolean;
}
export interface CommandOptions {
    requestKey: string;
    signal?: AbortSignal;
}
export interface AcceptedRun {
    conversationId: Id;
    runId: Id;
    messageId: Id;
    acceptedSeq: number;
}
/** Host-derived authority is INTERNAL ONLY; never accept this from the browser. */
export interface Principal {
    tenantId: Id;
    applicationId: Id;
    workspaceId: Id;
    actorId: Id;
    capabilities: ReadonlyArray<'conversations:read' | 'conversations:write' | 'skills:write' | 'tools:approve'>;
}
export interface ToolAdapter {
    id: string;
    version: string;
    /** Host validates runtime schema and ownership; a skill is not a permission grant. */
    validateArgs(args: unknown): Json;
    authorize(principal: Principal, action: Proposal['action']): Promise<boolean>;
    /** Recheck host revision atomically WITH mutation, not read-then-unconditional-write. */
    apply(input: {
        principal: Principal;
        effectKey: string;
        action: Proposal['action'];
        expectedRevision: string | null;
        signal: AbortSignal;
    }): Promise<{
        outcome: 'succeeded';
        resultingRevision: string;
        safeSummary: string;
    } | {
        outcome: 'conflict';
        actualRevision: string | null;
    } | {
        outcome: 'failed';
        safeSummary: string;
        retrySafe: boolean;
    } | {
        outcome: 'unknown';
        safeSummary: string;
    }>;
    /** Used after an ambiguous timeout. Missing receipts must not trigger blind replay. */
    reconcile(input: {
        principal: Principal;
        effectKey: string;
    }): Promise<{
        outcome: 'succeeded' | 'not_applied' | 'unknown';
        resultingRevision?: string;
    }>;
}
