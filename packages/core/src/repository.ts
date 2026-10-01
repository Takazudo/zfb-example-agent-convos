import type { Conversation, ConversationEvent, ContextView, Json, Message, Proposal, Run, SkillRevision } from './domain.js';
/** All of this is internal. None of these structures is accepted from an HTTP body. */
export interface Scope {
    id: string;
    tenantId: string;
    applicationId: string;
    workspaceId: string;
}
export interface Skill {
    id: string;
    name: string;
    description: string;
    headVersion: number;
}
export interface Manifest extends ContextView {
    policy: 'recipe-v1';
    provider: 'fake-v1';
    messages: Array<{
        id: string;
        role: 'user' | 'assistant';
        text: string;
    }>;
    skills: SkillRevision[];
    host: {
        resourceId: string;
        revision: string | null;
        text: string | null;
    };
    tool: {
        id: string;
        version: string;
    };
    hash: string;
}
export interface Claim {
    token: string;
    generation: number;
    expiresAt: string;
    attempt: number;
}
export interface StoredConversation {
    scopeId: string;
    ownerId: string;
    conversation: Conversation;
    messages: Message[];
    runs: Run[];
    proposals: Proposal[];
    manifests: Manifest[];
    claims: Record<string, Claim>;
}
export interface Receipt {
    operation: string;
    key: string;
    payloadHash: string;
    status: number;
    value: Json;
    at: string;
}
export interface WorkItem {
    id: string;
    scopeId: string;
    conversationId: string;
    runId: string;
    kind: 'generate' | 'apply' | 'reconcile';
    status: 'pending' | 'sent';
    attempt: number;
    nextAttemptAt: string;
    createdAt: string;
}
export interface Write {
    scope: Scope;
    actorId: string;
    beforeRevision: number | null;
    state: StoredConversation;
    events: ConversationEvent[];
    receipt: Receipt | null;
    outbox: WorkItem[];
    /** Every checkpoint/finish must still own its unexpired lease. */
    claimFence?: {
        runId: string;
        token: string;
        generation: number;
        now: string;
    };
}
export interface Repository {
    ensureScope(scope: Scope): Promise<void>;
    get(scopeId: string, actorId: string, conversationId: string): Promise<StoredConversation | null>;
    list(scopeId: string, actorId: string): Promise<Conversation[]>;
    receipt(scopeId: string, actorId: string, operation: string, key: string): Promise<Receipt | null>;
    commit(write: Write): Promise<void>;
    events(scopeId: string, actorId: string, conversationId: string, after: number): Promise<ConversationEvent[] | null>;
    skills(scopeId: string): Promise<Skill[]>;
    versions(scopeId: string, skillId: string): Promise<SkillRevision[]>;
    appendSkill(input: {
        scope: Scope;
        actorId: string;
        skill: Skill;
        expectedHead: number;
        revision: SkillRevision;
        receipt: Receipt | null;
    }): Promise<void>;
    work(now: string): Promise<WorkItem[]>;
    markSent(item: WorkItem, nextAttemptAt: string): Promise<void>;
    /** Sent-but-unclaimed / abandoned work is discoverable without a browser. */
    repair(now: string): Promise<number>;
    resolveWork(item: WorkItem): Promise<{
        state: StoredConversation;
        ownerId: string;
        scope: Scope;
    } | null>;
}
