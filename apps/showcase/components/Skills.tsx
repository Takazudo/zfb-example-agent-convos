import { computed, For, getScope, signal } from '@takazudo/zfb/zudo-react';
import type { ReadonlySignal, Ref } from '@takazudo/zfb/zudo-react';
import type { ConversationController } from './shared/packages/controller/src/controller';
import type { SkillRevision } from './shared/packages/core/src/domain';
type Skill = {
    id: string;
    name: string;
    description: string;
    headVersion: number;
};
/** Native dialog + keyed buttons: mutable skill options are not a reactive native select. */
export default function Skills({ controller }: {
    controller: ReadonlySignal<ConversationController | null>;
}) {
    const scope = getScope(), list = signal<Skill[]>([]), selected = signal<Skill | null>(null), versions = signal<SkillRevision[]>([]);
    const body = signal(''), note = signal(''), message = signal(''), busy = signal(false);
    const dialog: Ref<HTMLDialogElement> = { current: null };
    let epoch = 0;
    async function choose(skill: Skill) { const c = controller.value; if (!c)
        return; const token = ++epoch; selected.value = skill; dialog.current?.close(); try {
        const result = await c.client.skillHistory(skill.id, undefined, scope.abortSignal);
        if (scope.abortSignal.aborted || token !== epoch || c !== controller.value)
            return;
        if (!result.ok) {
            message.value = result.error.message;
            return;
        }
        versions.value = result.value.items;
        body.value = result.value.items[0]?.body ?? '';
        note.value = '';
    }
    catch {
        if (!scope.abortSignal.aborted && token === epoch && c === controller.value)
            message.value = 'Cannot load skill history.';
    } }
    async function load() { const c = controller.value; if (!c)
        return; try {
        const result = await c.client.skills(scope.abortSignal);
        if (scope.abortSignal.aborted || c !== controller.value)
            return;
        if (!result.ok) {
            message.value = result.error.message;
            return;
        }
        list.value = result.value;
        const current = result.value.find(s => s.id === selected.value?.id) ?? result.value[0];
        if (current)
            await choose(current);
    }
    catch {
        if (!scope.abortSignal.aborted)
            message.value = 'Cannot load skills.';
    } }
    scope.effect(() => { const c = controller.value; epoch++; pending = null; busy.value = false; selected.value = null; versions.value = []; body.value = ''; note.value = ''; message.value = ''; if (c) void load(); });
    // The outcome key is retained for ambiguous responses while this island remains mounted.
    let pending: {
        kind: 'save' | 'restore';
        key: string;
        id: string;
        head: number;
        body: string;
        note: string;
        version: number;
    } | null = null;
    async function write(sourceVersion?: number) {
        const c = controller.value, s = selected.value;
        if (!c || !s || busy.value)
            return;
        if (!pending)
            pending = { kind: sourceVersion === undefined ? 'save' : 'restore', key: `skill_${crypto.randomUUID().replaceAll('-', '')}`, id: s.id, head: s.headVersion, body: body.value, note: note.value || 'Edited instructions', version: sourceVersion ?? 0 };
        const p = pending;
        busy.value = true;
        try {
            const result = p.kind === 'save' ? await c.client.saveSkill(p.id, { expectedHead: p.head, body: p.body, note: p.note }, { requestKey: p.key }) : await c.client.restoreSkill(p.id, { expectedHead: p.head, sourceVersion: p.version }, { requestKey: p.key });
            if (scope.abortSignal.aborted || c !== controller.value)
                return;
            if (!result.ok) {
                pending = null;
                message.value = result.error.message;
                return;
            }
            pending = null;
            message.value = `Saved v${result.value.version}. Existing runs keep their original skill pins.`;
            await load();
        }
        catch {
            if (!scope.abortSignal.aborted && c === controller.value)
                message.value = 'Response not received. Save again to check the same command.';
        }
        finally {
            if (!scope.abortSignal.aborted && c === controller.value)
                busy.value = false;
        }
    }
    const items = () => <For each={list} by={s => s.id}>{item => <button type="button" class="ac-button ac-skill-item" on:click={() => { void choose(item.value); }}>{computed(() => `${item.value.name} · v${item.value.headVersion}`)}</button>}</For>;
    return <><aside class="ac-skill-list">{items()}</aside><div class="ac-skill-document">
    <button type="button" class="ac-button ac-skill-chooser" on:click={() => dialog.current?.showModal()}>{computed(() => selected.value?.name ?? 'Choose a skill')}</button>
    <h2>{computed(() => selected.value?.name ?? 'Versioned instructions')}</h2><p class="ac-muted">Accepted runs pin their instructions. Editing a skill cannot grant tool permissions.</p>
    <p role="status" class="ac-notice" hidden={computed(() => !message.value)}>{message}</p>
    <textarea class="ac-skill-body" aria-label="Skill instruction" modelValue={body} rows={12}/><div class="ac-skill-actions"><input class="ac-skill-note" aria-label="Revision note" placeholder="Revision note" modelValue={note}/><button type="button" class="ac-button ac-primary" disabled={busy} on:click={() => { void write(); }}>Save new version</button></div>
    <h3>Version history</h3><For each={versions} by={v => v.version}>{item => <details class="ac-version"><summary>{computed(() => `v${item.value.version} — ${item.value.note}`)}</summary><pre class="ac-version-body">{computed(() => item.value.body)}</pre><button type="button" class="ac-button" hidden={computed(() => item.value.version === selected.value?.headVersion)} disabled={busy} on:click={() => { void write(item.value.version); }}>Restore as new version</button></details>}</For>
  </div><dialog class="ac-dialog" ref={dialog} aria-label="Choose a skill"><header class="ac-dialog-head"><h2>Choose a skill</h2><button type="button" class="ac-button" on:click={() => dialog.current?.close()}>Close</button></header><div class="ac-dialog-body">{items()}</div></dialog></>;
}
