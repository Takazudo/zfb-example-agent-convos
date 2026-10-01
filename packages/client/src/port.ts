import type { AcceptedRun, CommandOptions, ContextView, Conversation, EventPage, Id, Message, Proposal, Result, Run, SkillRevision, Snapshot } from '../../core/src/domain.js';
/** Framework-neutral client contract shared by mock and HTTP implementations. */
export interface ConversationClient {
    list(query: {
        archived?: boolean;
        search?: string;
        cursor?: string;
    }, signal?: AbortSignal): Promise<Result<{
        items: Conversation[];
        nextCursor: string | null;
    }>>;
    create(input: {
        title?: string;
    }, options: CommandOptions): Promise<Result<Conversation>>;
    snapshot(conversationId: Id, signal?: AbortSignal): Promise<Result<Snapshot>>;
    history(conversationId: Id, before: Id, signal?: AbortSignal): Promise<Result<{
        messages: Message[];
        nextCursor: string | null;
    }>>;
    export(conversationId: Id, signal?: AbortSignal): Promise<Result<{
        schemaVersion: 1;
        snapshot: Snapshot;
    }>>;
    events(conversationId: Id, after: number, signal?: AbortSignal): Promise<Result<EventPage>>;
    update(conversationId: Id, input: {
        expectedRevision: number;
        title?: string;
        archived?: boolean;
    }, options: CommandOptions): Promise<Result<Conversation>>;
    send(conversationId: Id, input: {
        text: string;
        expectedRevision: number;
    }, options: CommandOptions): Promise<Result<AcceptedRun>>;
    cancel(conversationId: Id, runId: Id, options: CommandOptions): Promise<Result<Run>>;
    retry(conversationId: Id, runId: Id, options: CommandOptions): Promise<Result<AcceptedRun>>;
    decide(conversationId: Id, proposalId: Id, input: {
        decision: 'approve' | 'reject';
        payloadHash: string;
    }, options: CommandOptions): Promise<Result<Proposal>>;
    refreshProposal(conversationId: Id, proposalId: Id, options: CommandOptions): Promise<Result<AcceptedRun>>;
    context(conversationId: Id, runId: Id, signal?: AbortSignal): Promise<Result<ContextView>>;
    skills(signal?: AbortSignal): Promise<Result<Array<{
        id: Id;
        name: string;
        description: string;
        headVersion: number;
    }>>>;
    skillHistory(skillId: Id, cursor?: string, signal?: AbortSignal): Promise<Result<{
        items: SkillRevision[];
        nextCursor: string | null;
    }>>;
    saveSkill(skillId: Id, input: {
        expectedHead: number;
        body: string;
        note: string;
    }, options: CommandOptions): Promise<Result<SkillRevision>>;
    restoreSkill(skillId: Id, input: {
        expectedHead: number;
        sourceVersion: number;
    }, options: CommandOptions): Promise<Result<SkillRevision>>;
}
