"use client";
import { computed, For, getScope, Show, signal } from '@takazudo/zfb/zudo-react';
import type { ReadonlySignal, Ref } from '@takazudo/zfb/zudo-react';
import { createScenario, SCENARIOS, type Scenario, LOCAL } from './session';
import { ConversationController, latestRun, orderedMessages, shouldSendOnEnter, type ViewState } from './shared/packages/controller/src/controller';
import type { Message, Proposal } from './shared/packages/core/src/domain';
import Skills from './Skills';
function MessageRow({ item }: {
    item: ReadonlySignal<Message>;
}) {
    const css = computed(() => `ac-message ac-${item.value.role}`);
    const label = computed(() => `${item.value.role === 'user' ? 'You' : 'Demo assistant'}${item.value.state === 'partial' ? ' · partial response' : ''}`);
    return <article class={css} data-message-id={computed(() => item.value.id)}><div class="ac-message-meta">{label}</div><div class="ac-message-text">{computed(() => item.value.parts.map(p => p.text).join(''))}</div></article>;
}
function ProposalRow({ item, controller }: {
    item: ReadonlySignal<Proposal>;
    controller: ReadonlySignal<ConversationController | null>;
}) {
    const pending = computed(() => item.value.status === 'pending');
    const stale = computed(() => item.value.status === 'stale');
    return <article class="ac-proposal">
    <header class="ac-proposal-head"><h2>{computed(() => item.value.display.title)}</h2><span class="ac-proposal-status">{computed(() => item.value.status === 'pending' ? 'Needs review' : item.value.status)}</span></header>
    <p class="ac-path">{computed(() => item.value.display.path)}</p><p class="ac-proposal-explain">Review the exact change. Saving a draft is not publishing.</p>
    <details class="ac-diff"><summary>View exact changes</summary><p class="ac-eyebrow">BEFORE</p><pre class="ac-before">{computed(() => item.value.display.before ?? '(new resource)')}</pre><p class="ac-eyebrow">AFTER</p><pre class="ac-after">{computed(() => item.value.display.after)}</pre></details>
    <footer class="ac-proposal-foot"><Show when={pending}>{() => <>
      <button type="button" class="ac-button ac-primary" on:click={() => { void controller.value?.decide(item.value, 'approve'); }}>Approve &amp; save draft</button>
      <button type="button" class="ac-button" on:click={() => { void controller.value?.decide(item.value, 'reject'); }}>Reject</button>
    </>}</Show><Show when={stale}>{() => <button type="button" class="ac-button" on:click={() => { void controller.value?.refreshProposal(item.value); }}>Prepare a new proposal</button>}</Show></footer>
  </article>;
}
/** One deterministic client root. Runtime objects never cross the JSON Island boundary. */
export default function ConvosApp() {
    const scope = getScope();
    const controller = signal<ConversationController | null>(null);
    const view = signal<ViewState | null>(null);
    const draft = signal('');
    const search = signal('');
    const panel = signal<'chat' | 'skills'>('chat');
    const embedded = signal(false);
    const scenario = signal<Scenario>('Ready for review');
    const navOpen = signal(false);
    const details = signal('');
    const failure = signal('');
    const offline = signal(false);
    const jump = signal(false);
    const rename = signal('');
    const creating = signal(false);
    let renameId: string | null = null;
    const renameRef: Ref<HTMLDialogElement> = { current: null };
    const hostText = signal('');
    const hostRevision = signal('');
    const transcriptRef: Ref<HTMLDivElement> = { current: null };
    const dialogRef: Ref<HTMLDialogElement> = { current: null };
    const menuRef: Ref<HTMLDialogElement> = { current: null };
    let fixture: Awaited<ReturnType<typeof createScenario>> | null = null;
    let unsubscribe: (() => void) | null = null;
    let composing = false, generation = 0, savedCursor = -1, savedHostKey = '', savedConversation = '';
    let hostRead = 0;
    const rows = computed(() => orderedMessages(view.value?.projection ?? null));
    const conversations = computed(() => view.value?.conversations ?? []);
    const proposals = computed(() => Object.values(view.value?.projection?.proposals ?? {}));
    const lastRun = computed(() => latestRun(view.value?.projection ?? null));
    const runStatus = computed(() => lastRun.value?.status.replaceAll('_', ' ') ?? 'Draft a request to begin');
    const title = computed(() => panel.value === 'skills' ? 'Skills' : view.value?.projection?.conversation.title ?? 'Preparing conversation…');
    const notice = computed(() => failure.value || (view.value?.pending ? 'Response not confirmed. Check acceptance with the same key.' : view.value?.error ?? ''));
    const disabled = computed(() => !controller.value || !!view.value?.busy || !!view.value?.pending || !!view.value?.projection?.conversation.activeRun || !!view.value?.projection?.conversation.archived || !draft.value.trim());
    function choose(id: string) { panel.value = 'chat'; menuRef.current?.close(); void controller.value?.select(id); }
    function disposeCurrent() { unsubscribe?.(); unsubscribe = null; controller.value?.dispose(); fixture?.dispose(); fixture = null; }
    async function startScenario(value: Scenario) {
        const token = ++generation;
        disposeCurrent();
        view.value = null;
        controller.value = null;
        savedCursor = -1;
        savedHostKey = '';
        failure.value = '';
        offline.value = false;
        creating.value = false;
        search.value = '';
        panel.value = 'chat';
        jump.value = false;
        renameRef.current?.close();
        dialogRef.current?.close();
        try {
            const next = await createScenario(value);
            if (scope.abortSignal.aborted || token !== generation) {
                next.dispose();
                return;
            }
            fixture = next;
            const c = new ConversationController(next.client);
            controller.value = c;
            // Hydration may have accepted a pre-activation edit. Do not overwrite it with seed or storage state.
            const before = draft.value;
            await c.start(before);
            if (scope.abortSignal.aborted || token !== generation) {
                c.dispose();
                return;
            }
            if (draft.value !== before)
                c.setDraft(draft.value);
            unsubscribe = c.subscribe(s => {
                const scroll = transcriptRef.current;
                const changedThread = savedConversation !== (s.selectedId ?? '');
                const follow = changedThread || !scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
                const cursorChanged = s.projection?.cursor !== savedCursor;
                view.value = s;
                if (!composing && draft.value !== s.draft) draft.value = s.draft;
                if (scroll && (cursorChanged || changedThread)) {
                    if (follow) requestAnimationFrame(() => {
                        if (!scope.abortSignal.aborted && token === generation) {
                            scroll.scrollTop = scroll.scrollHeight;
                            jump.value = false;
                        }
                    });
                    else jump.value = true;
                }
                savedCursor = s.projection?.cursor ?? -1;
                savedConversation = s.selectedId ?? '';
                const stamp = Object.values(s.projection?.proposals ?? {}).map(p => `${p.id}:${p.status}`).join();
                if (stamp !== savedHostKey) {
                    savedHostKey = stamp;
                    const read = ++hostRead;
                    void next.readHost().then(h => { if (!scope.abortSignal.aborted && token === generation && read === hostRead) {
                        hostText.value = h.text ?? '';
                        hostRevision.value = h.revision ?? '';
                    } }).catch(() => { if (token === generation) failure.value = 'Unable to read the demo host.'; });
                }
            });
            c.startPolling();
            next.start();
            const read = ++hostRead;
            const h = await next.readHost();
            if (!scope.abortSignal.aborted && token === generation && read === hostRead) {
                hostText.value = h.text ?? '';
                hostRevision.value = h.revision ?? '';
            }
        }
        catch {
            if (!scope.abortSignal.aborted && token === generation)
                failure.value = 'Unable to initialize the conversation. No live-provider fallback is enabled.';
        }
    }
    scope.onActivate(() => { void startScenario(scenario.value); return () => { generation++; disposeCurrent(); }; });
    async function showDetails() {
        dialogRef.current?.showModal();
        const c = controller.value;
        const r = lastRun.value;
        const cid = view.value?.selectedId;
        if (!c || !r || !cid) {
            details.value = 'No run accepted yet.';
            return;
        }
        details.value = 'Loading…';
        try {
        const result = await c.client.context(cid, r.id, scope.abortSignal);
        if (!scope.abortSignal.aborted && c === controller.value && cid === view.value?.selectedId)
            details.value = JSON.stringify({ run: r, context: result.ok ? result.value : result.error, cursor: view.value?.projection?.cursor }, null, 2);
        } catch { if (c === controller.value) details.value = 'Cannot load details. Reconnect and try again.'; }
    }
    async function createConversation() {
        const c = controller.value;
        if (!c || creating.value) return;
        creating.value = true;
        panel.value = 'chat'; menuRef.current?.close();
        try { await c.create(); }
        finally { if (c === controller.value) creating.value = false; }
    }
    async function exportConversation() {
        const c = controller.value, cid = view.value?.selectedId;
        if (!c || !cid) return;
        try {
            const result = await c.client.export(cid, scope.abortSignal);
            if (scope.abortSignal.aborted || c !== controller.value) return;
            if (!result.ok) { failure.value = result.error.message; return; }
            const url = URL.createObjectURL(new Blob([JSON.stringify(result.value, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = `conversation-${cid}.json`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { if (c === controller.value) failure.value = 'Cannot export. Reconnect and try again.'; }
    }
    async function loadOlder() {
        const scroll = transcriptRef.current, c = controller.value, cid = view.value?.selectedId;
        const anchor = scroll?.querySelector<HTMLElement>('[data-message-id]');
        const top = anchor?.getBoundingClientRect().top;
        await c?.older();
        requestAnimationFrame(() => {
            if (scroll && anchor?.isConnected && top !== undefined && c === controller.value && cid === view.value?.selectedId)
                scroll.scrollTop += anchor.getBoundingClientRect().top - top;
        });
    }
    function toggleConnection() {
        offline.value = !offline.value; fixture?.setOffline(offline.value);
        void controller.value?.poll();
    }
    const threadList = () => <nav class="ac-threads" aria-label="Conversations"><For each={conversations} by={c => c.id}>{item => <button type="button" class="ac-thread" aria-current={computed(() => item.value.id === view.value?.selectedId ? 'true' : 'false')} on:click={() => choose(item.value.id)}><strong>{computed(() => item.value.title)}</strong><small>{computed(() => item.value.activeRun?.status.replaceAll('_', ' ') ?? 'Saved conversation')}</small></button>}</For></nav>;
    const navigation = () => <><div class="ac-side-brand">convos /</div><p class="ac-muted">Demo CMS / conversations</p>
    <button type="button" class="ac-button ac-primary ac-new" on:click={() => { void createConversation(); }}>+ New conversation</button>
    <div class="ac-tabs"><button type="button" class="ac-tab" aria-pressed={computed(() => panel.value === 'chat')} on:click={() => { panel.value = 'chat'; menuRef.current?.close(); }}>Conversations</button><button type="button" class="ac-tab" aria-pressed={computed(() => panel.value === 'skills')} on:click={() => { panel.value = 'skills'; menuRef.current?.close(); }}>Skills</button></div>
    <input type="search" class="ac-search" aria-label="Search conversations" placeholder="Search conversations" modelValue={search} on:input={e => { void controller.value?.refreshList((e.currentTarget as HTMLInputElement).value); }}/>
    {threadList()}<button type="button" class="ac-button ac-archive-toggle" on:click={() => { void controller.value?.setArchived(!view.value?.archived); }}>{computed(() => view.value?.archived ? 'Active conversations' : 'Archived conversations')}</button><p class="ac-side-foot">{LOCAL ? 'Synthetic data · saved on this device' : 'Synthetic data · resets with scenario'}<br />No model calls or cloud storage</p></>;
    return <div class={computed(() => `ac-shell${embedded.value ? ' ac-embedded' : ''}`)}>
    <header class="ac-lab"><span class="ac-lab-brand">zfb / RECIPE LAB</span><span class="ac-lab-note">{LOCAL ? 'zfb 3 · local SQLite · fake provider' : 'zfb 3 · mock-only showcase'}</span>
      <label class="ac-scenario-label" hidden={LOCAL}>Scenario <select aria-label="Scenario" modelValue={scenario} on:change={e => { draft.value = ''; void startScenario((e.currentTarget as HTMLSelectElement).value as Scenario); }}>{SCENARIOS.map(s => <option value={s}>{s}</option>)}</select></label>
      <div class="ac-segments"><button type="button" class="ac-segment" aria-pressed={computed(() => !embedded.value)} on:click={() => { embedded.value = false; }}>Standalone</button><button type="button" class="ac-segment" aria-pressed={embedded} on:click={() => { embedded.value = true; }}>In a CMS</button></div><button type="button" class="ac-button" on:click={toggleConnection}>{computed(() => offline.value ? 'Reconnect' : 'Disconnect')}</button><span class="ac-no-model">No model calls</span></header>
    <div class="ac-body"><aside class="ac-sidebar">{navigation()}</aside>
      <section class="ac-host"><div class="ac-host-bar">Demo CMS / Pages</div><article class="ac-host-document"><h2>October collection</h2><p>Saved draft · revision {hostRevision}</p><pre class="ac-host-text">{hostText}</pre><p class="ac-notice">Only an approved draft is saved. Nothing is published.</p></article></section>
      <main class="ac-main"><header class="ac-top"><button type="button" class="ac-button ac-nav-trigger" aria-label="Open navigation" on:click={() => { navOpen.value = true; menuRef.current?.showModal(); }}>☰</button><div class="ac-title-wrap"><p class="ac-eyebrow">CONVERSATION / RETAINED HISTORY</p><h1>{title}</h1></div><button type="button" class="ac-button" on:click={() => { void showDetails(); }}>Details</button><button type="button" class="ac-button" on:click={() => { void controller.value?.update({ archived: !view.value?.projection?.conversation.archived }); }}>{computed(() => view.value?.projection?.conversation.archived ? 'Restore' : 'Archive')}</button></header>
      <div class="ac-banner" role="status" hidden={computed(() => !notice.value)}><span>{notice}</span><button type="button" class="ac-button" hidden={computed(() => !view.value?.pending)} on:click={() => { void controller.value?.retryPending(); }}>Check acceptance</button><button type="button" class="ac-button" on:click={() => { void controller.value?.refresh(); }}>Refresh</button></div>
      <section class="ac-chat" hidden={computed(() => panel.value !== 'chat')}><div class="ac-scroll" ref={transcriptRef} on:scroll={() => { const el = transcriptRef.current; if (el) jump.value = el.scrollHeight - el.scrollTop - el.clientHeight > 100; }}><div class="ac-transcript">
        <button type="button" class="ac-button ac-older" hidden={computed(() => !view.value?.nextMessagePage)} on:click={() => { void loadOlder(); }}>Load older messages</button>
        <Show when={computed(() => !!view.value?.projection && rows.value.length === 0)}>{() => <div class="ac-empty"><p class="ac-eyebrow">ONE TASK, ONE CONVERSATION</p><h2>What shall we work on?</h2><p class="ac-muted">Draft a request. Review exact changes before saving anything.</p></div>}</Show>
        <For each={rows} by={m => m.id}>{item => <><MessageRow item={item}/><For each={computed(() => item.value.role === 'assistant' ? proposals.value.filter(p => p.runId === item.value.runId) : [])} by={p => p.id}>{proposal => <ProposalRow item={proposal} controller={controller}/>}</For></>}</For>
      </div></div><button type="button" class="ac-button ac-jump" hidden={computed(() => !jump.value)} on:click={() => { const el = transcriptRef.current; if (el) el.scrollTop = el.scrollHeight; jump.value = false; }}>Jump to latest ↓</button><div class="ac-compose-area"><div class="ac-run-line"><span data-run-status={computed(() => lastRun.value?.status ?? 'idle')}>{runStatus}</span><button type="button" class="ac-button" hidden={computed(() => !lastRun.value || !['queued', 'running', 'awaiting_approval'].includes(lastRun.value.status))} on:click={() => { if (lastRun.value)
        void controller.value?.cancel(lastRun.value); }}>Stop</button><button type="button" class="ac-button" hidden={computed(() => !lastRun.value || !['failed', 'cancelled'].includes(lastRun.value.status))} on:click={() => { if (lastRun.value)
        void controller.value?.retry(lastRun.value); }}>Retry run</button></div>
      <form class="ac-composer" on:submit={e => { e.preventDefault(); void controller.value?.send(); }}>
        <textarea disabled={creating} aria-label="Message" rows={3} placeholder="Ask about this task…" modelValue={draft} on:input={e => controller.value?.setDraft((e.currentTarget as HTMLTextAreaElement).value)} on:blur={e => { if (composing) {
        composing = false;
        controller.value?.setDraft((e.currentTarget as HTMLTextAreaElement).value);
    } }} on:compositionstart={() => { composing = true; }} on:compositionend={e => { composing = false; controller.value?.setDraft((e.currentTarget as HTMLTextAreaElement).value); }} on:keydown={e => { if (shouldSendOnEnter(e as KeyboardEvent, composing)) {
        e.preventDefault();
        void controller.value?.send();
    } }}/>
        <div class="ac-composer-bar"><span class="ac-muted">{LOCAL ? 'Local SQLite · retained on restart' : 'Synthetic session · resets on reload'}</span><button type="submit" class="ac-button ac-primary" disabled={disabled}>Send ↑</button></div>
      </form><div class="ac-compose-foot">Enter to send · Shift+Enter for a new line</div></div></section>
      <section class="ac-skills" hidden={computed(() => panel.value !== 'skills')}><Skills controller={controller}/></section>
    </main></div>
    <dialog class="ac-dialog" ref={dialogRef} aria-label="Conversation details"><header class="ac-dialog-head"><h2>Conversation details</h2><button type="button" class="ac-button" on:click={() => dialogRef.current?.close()}>Close</button></header><div class="ac-dialog-body"><button type="button" class="ac-button" on:click={() => { rename.value = view.value?.projection?.conversation.title ?? ''; renameId = view.value?.selectedId ?? null; renameRef.current?.showModal(); }}>Rename conversation</button> <button type="button" class="ac-button" on:click={() => { void exportConversation(); }}>Export conversation JSON</button><pre class="ac-json">{details}</pre></div></dialog>
    <dialog class="ac-dialog" ref={renameRef} aria-label="Rename conversation"><form on:submit={e => { e.preventDefault(); if (renameId === view.value?.selectedId && rename.value.trim()) { void controller.value?.update({ title: rename.value.trim() }); renameRef.current?.close(); } }}><header class="ac-dialog-head"><h2>Rename conversation</h2><button type="button" class="ac-button" on:click={() => renameRef.current?.close()}>Close</button></header><div class="ac-dialog-body"><label>Conversation title<input class="ac-search" modelValue={rename} maxlength={120}/></label><button type="submit" class="ac-button ac-primary" disabled={computed(() => !rename.value.trim())}>Save title</button></div></form></dialog>
    <dialog class="ac-dialog ac-nav-dialog" ref={menuRef} aria-label="Navigation" on:close={() => { navOpen.value = false; }}><header class="ac-dialog-head"><h2>Navigation</h2><button type="button" class="ac-button" on:click={() => menuRef.current?.close()}>Close</button></header><Show when={navOpen}>{() => <aside class="ac-sidebar">{navigation()}</aside>}</Show></dialog>
  </div>;
}
