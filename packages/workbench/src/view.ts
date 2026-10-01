import type { ConversationClient } from '../../client/src/port.js';
import type { Proposal, Result, SkillRevision } from '../../core/src/domain.js';
import { ConversationController, MemoryStorage, latestRun as selectLatestRun, orderedMessages, shouldSendOnEnter, type StoragePort, type ViewState } from '../../controller/src/controller.js';
export interface ViewOptions {
    client: ConversationClient;
    mode: 'mock' | 'sqlite';
    selectedId?: string;
    readHost?: () => Promise<{
        revision: string | null;
        text: string | null;
    }>;
    setOffline?: (value: boolean) => void;
    scenarios?: readonly string[];
    scenario?: string;
    changeScenario?: (value: string) => void;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content = '') => {
    const node = document.createElement(tag);
    node.className = className;
    if (content)
        node.textContent = content;
    return node;
};
function button(label: string, action: () => void | Promise<unknown>, className = 'ac-button') {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', () => { void Promise.resolve().then(action).catch(() => { }); });
    return b;
}
const unwrap = <T>(r: Result<T>) => { if (!r.ok)
    throw new Error(r.error.message); return r.value; };
const key = () => `ui_${crypto.randomUUID().replaceAll('-', '')}`;
function setText(n: Node, value: string) { if (n.textContent !== value)
    n.textContent = value; }
function browserStorage(): StoragePort {
    return { get(k) { return localStorage.getItem(`agent-convos:dev:${k}`); }, set(k, v) { localStorage.setItem(`agent-convos:dev:${k}`, v); }, remove(k) { localStorage.removeItem(`agent-convos:dev:${k}`); } };
}
/** Native-DOM developer workbench; not the zfb renderer. It exercises the production-neutral port/controller. */
export function mountWorkbench(root: HTMLElement, options: ViewOptions) {
    const controller = new ConversationController(options.client, options.mode === 'mock' ? new MemoryStorage() : browserStorage());
    const abort = new AbortController();
    let disposed = false, composing = false, offline = false, viewEpoch = 0;
    let renderedConversation: string | null = null;
    let currentPanel: 'chat' | 'skills' = 'chat';
    const shell = el('div', 'ac-shell');
    root.replaceChildren(shell);
    const lab = el('header', 'ac-lab');
    const brand = el('div', 'ac-lab-brand', 'zfb / RECIPE LAB');
    lab.append(brand, el('span', 'ac-lab-note', options.mode === 'mock' ? 'Native workbench · memory mock' : 'Native workbench · local SQLite'));
    const scenarioLabel = el('label', 'ac-scenario-label', 'Scenario ');
    const scenarios = el('select');
    scenarios.setAttribute('aria-label', 'Scenario');
    for (const value of options.scenarios ?? []) {
        const option = el('option', '', value);
        option.value = value;
        scenarios.append(option);
    }
    scenarios.value = options.scenario ?? '';
    scenarios.addEventListener('change', () => options.changeScenario?.(scenarios.value));
    scenarioLabel.append(scenarios);
    scenarioLabel.hidden = !options.scenarios;
    const standalone = button('Standalone', () => { shell.classList.remove('ac-embedded'); standalone.setAttribute('aria-pressed', 'true'); embedded.setAttribute('aria-pressed', 'false'); }, 'ac-segment');
    const embedded = button('In a CMS', () => { shell.classList.add('ac-embedded'); standalone.setAttribute('aria-pressed', 'false'); embedded.setAttribute('aria-pressed', 'true'); void updateHost(); }, 'ac-segment');
    standalone.setAttribute('aria-pressed', 'true');
    embedded.setAttribute('aria-pressed', 'false');
    const layout = el('div', 'ac-segments');
    layout.setAttribute('aria-label', 'Example layout');
    layout.append(standalone, embedded);
    lab.append(scenarioLabel, layout, el('span', 'ac-no-model', 'No model calls'));
    const body = el('div', 'ac-body');
    shell.append(lab, body);
    const side = el('aside', 'ac-sidebar');
    body.append(side);
    const sideBrand = el('div', 'ac-side-brand', 'convos /');
    side.append(sideBrand, el('p', 'ac-muted', 'Demo CMS / conversations'));
    const newButton = button('+ New conversation', async () => { await controller.create(); setPanel('chat'); closeNavigation(); }, 'ac-button ac-primary ac-new');
    side.append(newButton);
    const tabs = el('div', 'ac-tabs');
    const chatTab = button('Conversations', () => setPanel('chat'), 'ac-tab'), skillTab = button('Skills', () => { setPanel('skills'); void loadSkills(); }, 'ac-tab');
    tabs.append(chatTab, skillTab);
    side.append(tabs);
    const search = el('input', 'ac-search');
    search.type = 'search';
    search.placeholder = 'Search conversations';
    search.setAttribute('aria-label', 'Search conversations');
    search.addEventListener('input', () => { void controller.refreshList(search.value); });
    side.append(search);
    const sideLabel = el('p', 'ac-eyebrow', 'CONVERSATIONS');
    const threads = el('nav', 'ac-threads');
    threads.setAttribute('aria-label', 'Conversations');
    side.append(sideLabel, threads);
    const archiveToggle = button('Archived conversations', async () => { await controller.setArchived(!controller.state.archived); setText(archiveToggle, controller.state.archived ? 'Active conversations' : 'Archived conversations'); }, 'ac-button ac-archive-toggle');
    side.append(archiveToggle, el('p', 'ac-side-foot', options.mode === 'mock' ? 'Synthetic data · resets with scenario\nNo shared or cloud storage' : 'Synthetic data · stored in local SQLite\nLoopback-only development server'));
    const host = el('section', 'ac-host');
    host.setAttribute('aria-label', 'CMS draft preview');
    host.append(el('div', 'ac-host-bar', 'Demo CMS / Pages'), el('p', 'ac-eyebrow', 'HOST APPLICATION'));
    const hostDoc = el('article', 'ac-host-document');
    const hostRevision = el('p', 'ac-muted', 'Draft');
    const hostText = el('pre', 'ac-host-text');
    hostDoc.append(el('h2', '', 'October collection'), hostRevision, hostText, el('p', 'ac-notice', 'Only an approved draft is saved. Nothing is published.'));
    host.append(hostDoc);
    body.append(host);
    const main = el('main', 'ac-main');
    body.append(main);
    const top = el('header', 'ac-top');
    const navTrigger = button('☰', () => openNavigation(), 'ac-button ac-nav-trigger');
    navTrigger.setAttribute('aria-label', 'Open navigation');
    const heading = el('div', 'ac-title-wrap');
    const eyebrow = el('p', 'ac-eyebrow', 'CONVERSATION / RETAINED HISTORY'), title = el('h1', '', 'Loading conversation…');
    heading.append(eyebrow, title);
    const status = el('span', 'ac-status', 'Connecting');
    status.setAttribute('role', 'status');
    const detailsTrigger = button('Details', () => { detailsDialog.showModal(); void updateDetails(); });
    const renameTrigger = button('Rename', () => { renameInput.value = controller.state.projection?.conversation.title ?? ''; renameDialog.showModal(); });
    const archive = button('Archive', () => controller.update({ archived: !controller.state.projection?.conversation.archived }));
    top.append(navTrigger, heading, status, detailsTrigger, renameTrigger, archive);
    main.append(top);
    const notice = el('div', 'ac-banner');
    notice.setAttribute('role', 'status');
    const noticeText = el('span');
    const checkPending = button('Check acceptance', () => controller.retryPending());
    const reconnect = button('Reconnect', async () => { offline = false; options.setOffline?.(false); setText(disconnect, 'Simulate disconnect'); await controller.refresh(); await controller.poll(); });
    notice.append(noticeText, checkPending, reconnect);
    notice.hidden = true;
    main.append(notice);
    const chat = el('section', 'ac-chat');
    chat.setAttribute('aria-label', 'Conversation');
    main.append(chat);
    const scroll = el('div', 'ac-scroll');
    const transcript = el('div', 'ac-transcript');
    const older = button('Load older messages', () => controller.older(), 'ac-button ac-older');
    const messages = el('div', 'ac-messages');
    const empty = el('div', 'ac-empty');
    empty.append(el('p', 'ac-eyebrow', 'ONE TASK, ONE CONVERSATION'), el('h2', '', 'What shall we work on?'), el('p', 'ac-muted', 'Create a page, revise some copy, or continue a saved conversation. Every change starts with a review.'));
    empty.append(button('Draft an October release page', () => { controller.setDraft('Create the October release page. Keep it as a draft.'); textarea.focus(); }, 'ac-button ac-starter'));
    transcript.append(older, empty, messages);
    scroll.append(transcript);
    chat.append(scroll);
    const composerArea = el('div', 'ac-compose-area');
    const runLine = el('div', 'ac-run-line');
    const runText = el('span');
    const stop = button('Stop', () => { const r = latestRun(); if (r)
        return controller.cancel(r); });
    const retry = button('Retry run', () => { const r = latestRun(); if (r)
        return controller.retry(r); });
    runLine.append(runText, stop, retry);
    const composer = el('form', 'ac-composer');
    const textarea = el('textarea');
    textarea.rows = 3;
    textarea.placeholder = 'Ask about this task…';
    textarea.setAttribute('aria-label', 'Message');
    textarea.addEventListener('compositionstart', () => { composing = true; });
    textarea.addEventListener('compositionend', () => { composing = false; controller.setDraft(textarea.value); });
    textarea.addEventListener('input', () => controller.setDraft(textarea.value));
    textarea.addEventListener('keydown', e => { if (shouldSendOnEnter(e, composing)) {
        e.preventDefault();
        void controller.send();
    } });
    textarea.addEventListener('blur', () => { if (composing) {
        composing = false;
        controller.setDraft(textarea.value);
    } });
    const composerBar = el('div', 'ac-composer-bar');
    const storageLabel = el('span', 'ac-muted', 'Draft stays in this browser');
    const send = button('Send ↑', () => controller.send(), 'ac-button ac-primary');
    send.setAttribute('aria-label', 'Send message');
    composerBar.append(storageLabel, send);
    composer.append(textarea, composerBar);
    composer.addEventListener('submit', e => { e.preventDefault(); void controller.send(); });
    const composeFoot = el('div', 'ac-compose-foot');
    const disconnect = button('Simulate disconnect', async () => { offline = !offline; options.setOffline?.(offline); setText(disconnect, offline ? 'Restore connection' : 'Simulate disconnect'); if (offline)
        await controller.poll();
    else
        await controller.refresh(); }, 'ac-link');
    disconnect.hidden = !options.setOffline;
    composeFoot.append(el('span', '', 'Enter to send · Shift+Enter for a new line'), disconnect);
    composerArea.append(runLine, composer, composeFoot);
    chat.append(composerArea);
    const jump = button('↓ Latest messages', () => scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' }), 'ac-button ac-jump');
    jump.hidden = true;
    chat.append(jump);
    scroll.addEventListener('scroll', () => { jump.hidden = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80; });
    function dialog(label: string, className = 'ac-dialog') {
        const d = el('dialog', className);
        d.setAttribute('aria-label', label);
        const h = el('div', 'ac-dialog-head');
        h.append(el('h2', '', label), button('Close', () => d.close()));
        d.append(h);
        shell.append(d);
        return d;
    }
    const navDialog = dialog('Navigation', 'ac-dialog ac-nav-dialog');
    const navSlot = el('div');
    navDialog.append(navSlot);
    function openNavigation() { navSlot.append(side); navDialog.showModal(); }
    function closeNavigation() { if (navDialog.open)
        navDialog.close(); }
    navDialog.addEventListener('close', () => body.insertBefore(side, host));
    const detailsDialog = dialog('Conversation details');
    const detailsBody = el('div', 'ac-dialog-body');
    const detailsSummary = el('p', 'ac-muted');
    const detailsJson = el('pre', 'ac-json');
    const exportButton = button('Export conversation JSON', async () => {
        const cid = controller.state.selectedId;
        if (!cid)
            return;
        try {
            const data = unwrap(await options.client.export(cid));
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = el('a');
            a.href = url;
            a.download = `conversation-${cid}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch {
            setText(detailsSummary, 'Export failed. Reconnect and try again.');
        }
    });
    detailsBody.append(detailsSummary, exportButton, detailsJson);
    detailsDialog.append(detailsBody);
    const renameDialog = dialog('Rename conversation');
    const renameBody = el('form', 'ac-dialog-body');
    const renameInput = el('input');
    renameInput.setAttribute('aria-label', 'Conversation title');
    renameInput.maxLength = 120;
    const renameSave = el('button', 'ac-button ac-primary', 'Save name');
    renameSave.type = 'submit';
    renameBody.append(renameInput, renameSave);
    renameBody.addEventListener('submit', e => { e.preventDefault(); void controller.update({ title: renameInput.value }).then(() => { if (!controller.state.error)
        renameDialog.close(); }); });
    renameDialog.append(renameBody);
    detailsBody.insertBefore(button('Rename conversation', () => { detailsDialog.close(); renameInput.value = controller.state.projection?.conversation.title ?? ''; renameDialog.showModal(); }), detailsJson);
    // Skills are a separate surface but use exactly the same client. Current instructions are never substituted into retained run pins.
    const skillsPanel = el('section', 'ac-skills');
    skillsPanel.hidden = true;
    main.append(skillsPanel);
    const skillList = el('div', 'ac-skill-list');
    skillList.setAttribute('aria-label', 'Skill list');
    const skillDocument = el('div', 'ac-skill-document');
    skillsPanel.append(skillList, skillDocument);
    const skillChooser = button('Choose a skill', () => { skillDialog.showModal(); }, 'ac-button ac-skill-chooser');
    const skillTitle = el('h2', '', 'Versioned instructions');
    const skillDescription = el('p', 'ac-muted', 'Runs pin an immutable revision when the request is accepted.');
    const skillMessage = el('p', 'ac-notice');
    skillMessage.hidden = true;
    skillMessage.setAttribute('role', 'status');
    const skillBody = el('textarea', 'ac-skill-body');
    skillBody.setAttribute('aria-label', 'Skill instruction');
    skillBody.rows = 12;
    const skillNote = el('input', 'ac-skill-note');
    skillNote.placeholder = 'Revision note';
    skillNote.setAttribute('aria-label', 'Revision note');
    const skillSave = button('Save new version', () => saveSkill(), 'ac-button ac-primary');
    const skillActions = el('div', 'ac-skill-actions');
    skillActions.append(skillNote, skillSave);
    const historyTitle = el('h3', '', 'Version history');
    const versions = el('div', 'ac-versions');
    skillDocument.append(skillChooser, skillTitle, skillDescription, skillMessage, skillBody, skillActions, historyTitle, versions);
    const skillDialog = dialog('Choose a skill');
    const skillDialogList = el('div', 'ac-dialog-body');
    skillDialog.append(skillDialogList);
    let selectedSkill: string | null = null, head = 0, skillLoadEpoch = 0;
    let skillPending: {
        key: string;
        kind: 'save';
        sid: string;
        input: {
            expectedHead: number;
            body: string;
            note: string;
        };
    } | {
        key: string;
        kind: 'restore';
        sid: string;
        input: {
            expectedHead: number;
            sourceVersion: number;
        };
    } | null = null;
    function skillError(message: string) { setText(skillMessage, message); skillMessage.hidden = false; }
    async function loadSkills() {
        try {
            const list = unwrap(await options.client.skills());
            skillList.replaceChildren();
            skillDialogList.replaceChildren();
            for (const s of list) {
                const choose = () => { selectedSkill = s.id; void loadSkill(s.id, s.name); if (skillDialog.open)
                    skillDialog.close(); };
                const b = button(`${s.name} · v${s.headVersion}`, choose, 'ac-button ac-skill-item');
                skillList.append(b);
                skillDialogList.append(button(s.name, choose, 'ac-button ac-skill-item'));
            }
            if (!selectedSkill && list[0])
                selectedSkill = list[0].id;
            const current = list.find(s => s.id === selectedSkill);
            if (current)
                await loadSkill(current.id, current.name);
        }
        catch {
            skillError('Cannot load skills. Reconnect and try again.');
        }
    }
    async function loadSkill(sid: string, name: string) {
        const token = ++skillLoadEpoch;
        try {
            const result = unwrap(await options.client.skillHistory(sid));
            if (disposed || token !== skillLoadEpoch)
                return;
            const current = result.items[0];
            if (!current)
                return;
            head = current.version;
            selectedSkill = sid;
            setText(skillTitle, name);
            setText(skillChooser, `${name} · v${head}`);
            skillBody.value = current.body;
            skillNote.value = '';
            versions.replaceChildren();
            for (const v of result.items) {
                const row = el('details', 'ac-version');
                const summary = el('summary', '', `v${v.version}${v.version === head ? ' · current' : ''} — ${v.note}`);
                const pre = el('pre', 'ac-version-body', v.body);
                row.append(summary, pre);
                if (v.version !== head)
                    row.append(button(`Restore v${v.version} as new version`, () => restoreSkill(v), 'ac-button'));
                versions.append(row);
            }
        }
        catch {
            skillError('Cannot load revision history.');
        }
    }
    async function performSkill() {
        const p = skillPending;
        if (!p)
            return;
        skillSave.disabled = true;
        try {
            const result = p.kind === 'save' ? await options.client.saveSkill(p.sid, p.input, { requestKey: p.key }) : await options.client.restoreSkill(p.sid, p.input, { requestKey: p.key });
            if (!result.ok) {
                skillPending = null;
                skillError(result.error.message + ' Reload the skill before changing its base.');
                return;
            }
            skillPending = null;
            skillError(`Saved v${result.value.version}. Existing runs retain their original skill pins.`);
            await loadSkills();
        }
        catch {
            skillError('Response not received. Save again to check the same command, without duplicating it.');
        }
        finally {
            skillSave.disabled = false;
        }
    }
    async function saveSkill() { if (!selectedSkill)
        return; if (!skillPending)
        skillPending = { kind: 'save', key: key(), sid: selectedSkill, input: { expectedHead: head, body: skillBody.value, note: skillNote.value || 'Edited instructions' } }; await performSkill(); }
    async function restoreSkill(v: SkillRevision) { if (!selectedSkill)
        return; if (!skillPending)
        skillPending = { kind: 'restore', key: key(), sid: selectedSkill, input: { expectedHead: head, sourceVersion: v.version } }; await performSkill(); }
    function setPanel(value: 'chat' | 'skills') { currentPanel = value; chat.hidden = value !== 'chat'; skillsPanel.hidden = value !== 'skills'; chatTab.setAttribute('aria-pressed', String(value === 'chat')); skillTab.setAttribute('aria-pressed', String(value === 'skills')); closeNavigation(); render(controller.state); }
    const threadRows = new Map<string, {
        node: HTMLButtonElement;
        label: HTMLElement;
        meta: HTMLElement;
    }>();
    const messageRows = new Map<string, {
        node: HTMLElement;
        body: HTMLElement;
        meta: HTMLElement;
    }>();
    const proposalRows = new Map<string, {
        node: HTMLElement;
        title: HTMLElement;
        status: HTMLElement;
        before: HTMLElement;
        after: HTMLElement;
        approve: HTMLButtonElement;
        reject: HTMLButtonElement;
        refresh: HTMLButtonElement;
        item: Proposal;
    }>();
    function latestRun() { return selectLatestRun(controller.state.projection); }
    let hostEpoch = 0, hostStamp = '';
    async function updateHost() { if (!options.readHost)
        return; const token = ++hostEpoch; try {
        const doc = await options.readHost();
        if (disposed || token !== hostEpoch)
            return;
        setText(hostRevision, `Saved draft · revision ${doc.revision}`);
        setText(hostText, doc.text ?? '(no saved draft)');
    }
    catch {
        setText(hostRevision, 'Host preview unavailable');
    } }
    async function updateDetails() { const cid = controller.state.selectedId, r = latestRun(); const token = ++viewEpoch; setText(detailsSummary, 'Run state, pinned context and replay cursor. No private model prompt is exposed.'); try {
        const context = cid && r ? unwrap(await options.client.context(cid, r.id)) : null;
        if (disposed || token !== viewEpoch)
            return;
        setText(detailsJson, JSON.stringify({ conversationId: cid, cursor: controller.state.projection?.cursor, run: r ?? null, context }, null, 2));
    }
    catch {
        setText(detailsSummary, 'Context is unavailable while disconnected.');
    } }
    function render(s: ViewState) {
        if (disposed)
            return;
        setText(title, currentPanel === 'skills' ? 'Skills' : s.projection?.conversation.title ?? (s.loading ? 'Loading conversation…' : 'Select a conversation'));
        setText(eyebrow, currentPanel === 'skills' ? 'WORKSPACE / VERSIONED INSTRUCTIONS' : 'CONVERSATION / RETAINED HISTORY');
        setText(status, s.connection === 'connected' ? '● Connected' : s.connection === 'disconnected' ? '○ Disconnected' : 'Connecting');
        status.dataset.state = s.connection;
        archive.hidden = renameTrigger.hidden = detailsTrigger.hidden = currentPanel !== 'chat';
        archive.disabled = s.busy || !s.projection;
        setText(archive, s.projection?.conversation.archived ? 'Restore' : 'Archive');
        const note = s.pending ? 'Request outcome is not yet confirmed. Check acceptance with the same request key.' : s.connection === 'disconnected' ? 'Disconnected. Retained events will replay after reconnect.' : s.error ?? '';
        notice.hidden = !note;
        setText(noticeText, note);
        checkPending.hidden = !s.pending;
        checkPending.disabled = s.busy;
        reconnect.hidden = s.connection !== 'disconnected';
        setText(storageLabel, options.mode === 'mock' ? 'Synthetic session · resets on reload' : s.storageAvailable ? 'Draft stays in this browser' : 'Storage unavailable · draft is session-only');
        for (const c of s.conversations) {
            let row = threadRows.get(c.id);
            if (!row) {
                const node = button('', async () => { await controller.select(c.id); setPanel('chat'); closeNavigation(); }, 'ac-thread');
                const label = el('strong'), meta = el('small');
                node.append(label, meta);
                node.dataset.id = c.id;
                row = { node, label, meta };
                threadRows.set(c.id, row);
            }
            setText(row.label, c.title);
            setText(row.meta, c.activeRun?.status.replaceAll('_', ' ') ?? 'Saved conversation');
            row.node.setAttribute('aria-current', String(c.id === s.selectedId));
            if (!row.node.parentElement)
                threads.append(row.node);
        }
        for (const [id, row] of threadRows)
            if (!s.conversations.some(c => c.id === id)) {
                row.node.remove();
                threadRows.delete(id);
            }
        if (!composing && textarea.value !== s.draft)
            textarea.value = s.draft;
        send.disabled = s.busy || !!s.pending || !!s.projection?.conversation.activeRun || !!s.projection?.conversation.archived || !s.draft.trim();
        const run = latestRun();
        setText(runText, run ? run.status.replaceAll('_', ' ') : 'Draft a request to begin');
        runText.dataset.runStatus = run?.status ?? 'none';
        stop.hidden = !run || !['queued', 'running', 'awaiting_approval', 'cancel_requested'].includes(run.status);
        stop.disabled = s.busy || run?.status === 'cancel_requested';
        retry.hidden = !run || !['failed', 'cancelled'].includes(run.status);
        retry.disabled = s.busy;
        older.hidden = !s.nextMessagePage;
        if (renderedConversation !== s.selectedId) {
            messageRows.clear();
            proposalRows.clear();
            messages.replaceChildren();
            renderedConversation = s.selectedId;
        }
        const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
        const anchor = Array.from(messages.children).find(n => n.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top);
        const anchorTop = anchor?.getBoundingClientRect().top;
        const transcriptMessages = orderedMessages(s.projection);
        empty.hidden = transcriptMessages.length > 0 || s.loading;
        for (const m of transcriptMessages) {
            let row = messageRows.get(m.id);
            if (!row) {
                const node = el('article', `ac-message ac-${m.role}`);
                node.dataset.messageId = m.id;
                const meta = el('div', 'ac-message-meta'), body = el('div', 'ac-message-text');
                node.append(meta, body);
                row = { node, body, meta };
                messageRows.set(m.id, row);
                messages.append(node);
            }
            setText(row.meta, `${m.role === 'user' ? 'You' : 'Demo assistant'}${m.state === 'streaming' ? ' · generating' : m.state === 'partial' ? ' · partial response' : ''}`);
            setText(row.body, m.parts.map(p => p.text).join(''));
        }
        for (const p of Object.values(s.projection?.proposals ?? {})) {
            let row = proposalRows.get(p.id);
            if (!row) {
                const node = el('article', 'ac-proposal');
                node.dataset.proposalId = p.id;
                const title = el('h2'), status = el('span', 'ac-proposal-status');
                const header = el('div', 'ac-proposal-head');
                header.append(title, status);
                const path = el('p', 'ac-path', p.display.path);
                const details = el('details', 'ac-diff');
                details.append(el('summary', '', 'View exact changes'));
                const before = el('pre', 'ac-before'), after = el('pre', 'ac-after');
                details.append(el('p', 'ac-eyebrow', 'BEFORE'), before, el('p', 'ac-eyebrow', 'AFTER'), after);
                const approve = button('Approve & save draft', () => controller.decide(proposalRows.get(p.id)!.item, 'approve'), 'ac-button ac-primary');
                const reject = button('Reject', () => controller.decide(proposalRows.get(p.id)!.item, 'reject'));
                const refresh = button('Prepare a new proposal', () => controller.refreshProposal(proposalRows.get(p.id)!.item));
                const footer = el('div', 'ac-proposal-foot');
                footer.append(approve, reject, refresh);
                node.append(header, path, el('p', 'ac-proposal-explain', 'Review the exact change. Saving a draft is not publishing.'), details, footer);
                row = { node, title, status, before, after, approve, reject, refresh, item: p };
                proposalRows.set(p.id, row);
                messages.append(node);
            }
            row.item = p;
            setText(row.title, p.display.title);
            setText(row.status, p.status === 'pending' ? 'Needs review' : p.status);
            setText(row.before, p.display.before ?? '(new resource)');
            setText(row.after, p.display.after);
            row.approve.hidden = row.reject.hidden = p.status !== 'pending';
            row.refresh.hidden = p.status !== 'stale';
            row.approve.disabled = row.reject.disabled = row.refresh.disabled = s.busy || !!s.pending;
        }
        // Place message/proposal nodes in transcript order without replacing existing DOM or open disclosures.
        let previous: Element | null = null;
        const ordered: HTMLElement[] = [];
        for (const m of transcriptMessages) {
            ordered.push(messageRows.get(m.id)!.node);
            if (m.role === 'assistant')
                for (const p of Object.values(s.projection?.proposals ?? {}))
                    if (p.runId === m.runId)
                        ordered.push(proposalRows.get(p.id)!.node);
        }
        for (const row of proposalRows.values())
            if (!ordered.includes(row.node))
                ordered.push(row.node);
        for (const node of ordered) {
            const next: Element | null = previous ? previous.nextElementSibling : messages.firstElementChild;
            if (next !== node)
                messages.insertBefore(node, next);
            previous = node;
        }
        if (!nearBottom && anchor && anchorTop !== undefined && anchor.isConnected)
            scroll.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
        if (nearBottom)
            requestAnimationFrame(() => { if (!disposed)
                scroll.scrollTop = scroll.scrollHeight; });
        const stamp = Object.values(s.projection?.proposals ?? {}).map(p => `${p.id}:${p.status}`).join();
        if (stamp !== hostStamp) {
            hostStamp = stamp;
            void updateHost();
        }
        if (detailsDialog.open)
            void updateDetails();
    }
    const unsubscribe = controller.subscribe(render);
    void controller.refreshList().then(async () => { const cid = options.selectedId ?? controller.state.conversations[0]?.id; if (cid)
        await controller.select(cid); controller.startPolling(); });
    void updateHost();
    chatTab.setAttribute('aria-pressed', 'true');
    window.addEventListener('pagehide', dispose, { signal: abort.signal });
    function dispose() { if (disposed)
        return; disposed = true; abort.abort(); unsubscribe(); controller.dispose(); for (const d of shell.querySelectorAll('dialog'))
        if (d.open)
            d.close(); }
    return { controller, dispose };
}
