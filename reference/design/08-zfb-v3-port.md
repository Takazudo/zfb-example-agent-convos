# 08 · zfb 3.0.0 baseline and frontend port

**Plan revision:** 2026-09-30, Asia/Tokyo. This document supersedes the original unresolved v3 availability caveat. It does not change the conversation, event, approval, or storage contracts.

## 1. Release identity and what is actually verified

GitHub's latest stable release is **v3.0.0**, published **2026-09-29T15:28:59Z / September 30, 2026 00:28:59 JST**. The tag points to commit `8219310917c4e697a5c9eb292bd68b4ae7a7cefc`. Both tagged SDK and runtime manifests declare `3.0.0`.

This fixes the implementation target. There is no longer a product decision to wait for a prerelease or ask for a custom local build. Installation, tarball contents, and the first actual zfb build still need local verification: npm-registry requests failed in this environment, and no zfb package was installed here. See the source record in `../provenance/zfb-v3.0.0.json` and the distinction between selected and installed versions in `stack-lock.md`.

## 2. Selected stack

| Concern | Decision |
| --- | --- |
| Frontend engine/SDK | Exact `@takazudo/zfb@3.0.0` |
| zfb runtime | Exact `@takazudo/zfb-runtime@3.0.0` |
| Renderer | Bundled `@takazudo/zfb/zudo-react`; no separate renderer dependency |
| Styling | Authored CSS/design tokens with `wind: false`; keep the explicit prototype reset |
| JSX | `react-jsx` plus `jsxImportSource: @takazudo/zfb/zudo-react` |
| Interactive boundary | One load-scheduled conversation root per mounted app surface; ordinary components below it |
| Frontend build | zfb static shell/islands, not a new Vite/React application |
| Backend | Existing plan: independently authored Worker gateway, private conversation Worker, D1, queue/outbox |
| SSR adapter | Omitted: a static shell plus a separate gateway does not need zfb SSR |
| Public showcase | Separate mock-only build graph; no private/live adapter imports |

The authored-CSS choice does not reject zudo-wind. It avoids turning an engine migration into an unnecessary visual rewrite. A later utility adoption can explicitly define tokens, breakpoints, and a reset; v3 does not supply Tailwind's implicit defaults.

Merge these values into the actual project rather than replacing a populated manifest:

```json
{
  "dependencies": {
    "@takazudo/zfb-runtime": "3.0.0"
  },
  "devDependencies": {
    "@takazudo/zfb": "3.0.0"
  }
}
```

The relevant configuration fragment is:

```ts
import { defineConfig } from "@takazudo/zfb/config";

export default defineConfig({
  wind: false,
  // Keep actual project paths, layout, and other supported configuration here.
});
```

The TypeScript fragment is:

```json
{
  "compilerOptions": {
    "strict": true,
    "jsx": "react-jsx",
    "jsxImportSource": "@takazudo/zfb/zudo-react"
  }
}
```

`react-jsx` is the TypeScript emit mode, not a request to install React. Remove the old `framework` and `tailwind` config keys, old JSX aliases, direct React/Preact integration dependencies, Tailwind imports/directives, and Tailwind environment overrides. `wind: false` does not make leftover Tailwind directives valid. Keep Node/pnpm/TypeScript/Worker tools pinned through the project's tooling process; the tagged SDK/runtime minimums are Node 22 and pnpm 10, not complete lockfile recommendations.

## 3. One client root, with a strict boundary

Use a named component in a `"use client"` file and the supported `<Island when="load">` wrapper. The wrapper owns identity and transport metadata; do not hand-author `data-zfb-*` markup.

The island's transported props must be public, JSON-safe bootstrap values. Do not put a `ConversationClient`, callbacks, signals, abort controllers, authentication tokens, or service-binding handles into those props. Construct the selected mock or HTTP controller inside its client build and pass live values/ports explicitly to descendants. There is no need for React Context or a global controller singleton.

Keep initial server and browser setup deterministic: no `Date.now()`, random conversation IDs, browser storage, viewport measurements, or network work during setup. Activate the controller and read browser preferences/drafts in `scope.onActivate`. Register cleanup synchronously. A private user's transcript must not be embedded into a publicly generated static page.

Hydration preserving a pre-existing textarea edit is only half the requirement. An activation callback that subsequently restores localStorage must not overwrite that edit. Restore a stored draft only when the live draft is still pristine relative to its bootstrap state, or after an explicit per-thread draft-selection decision.

## 4. Port behavior, not the prototype renderer

| Prototype need | v3 implementation |
| --- | --- |
| Mutable UI state | Writable `signal()` values created per component/controller instance |
| Live text/attributes/classes | Pass the signal/computed object into JSX; `.value` is a snapshot unless read in a tracked callback |
| Same-ID checkpoint replacement | `For` keyed by durable message/proposal ID, with computed bindings reading each readonly item signal |
| Conditional branch | `Show`; switching branches disposes their owned subtree |
| A control that must keep focus/state | Keep it mounted and bind visibility/disabled state; do not recreate the composer every update |
| Initial browser subscription | `scope.onActivate` with synchronous cleanup registration |
| Signal-driven side effect | `scope.effect`, with cleanup before resubscription |
| Requests/polling | Scope-owned abort plus per-thread/per-request generation guards for stale completions |
| Drawer/modal | Native `<dialog>` with refs and browser lifecycle, not portals |
| Expected failure | Explicit application error state; do not assume a React error boundary exists |

The most important v3 distinction is that setup does not rerun when a signal changes. This illustrative binding example is not a complete conversation component:

```tsx
import { computed, For, signal } from "@takazudo/zfb/zudo-react";

type PreviewRow = { id: string; text: string };

function TranscriptExample() {
  const rows = signal<PreviewRow[]>([]);
  return (
    <section>
      <For each={rows} by={(row) => row.id}>
        {(row) => {
          const text = computed(() => row.value.text);
          return <article>{text}</article>;
        }}
      </For>
    </section>
  );
}
```

Production derives its row content from `MessageView.parts`, not this simplified `text` field. Do not copy `rows.value.map(...)` into initial JSX and expect later checkpoints to re-render it. Do not key a message by its text or timestamp. Keep expanded diffs, native details state, selection, and the reader's scroll anchor stable while the same message is replaced.

Own browser reads separately from server work: disposing a view cancels its subscription/request, not the durable agent run. Sending a server cancellation remains an explicit domain command. Thread switching saves draft/scroll state for the old thread and establishes a new view subscription; a late old-thread response must not overwrite the new projection.

## 5. Composer and Japanese input

Use a real textarea with a **writable string signal through `modelValue`**. Do not supply a reactive `value` or a computed/readonly signal as the writable model. Keep that textarea mounted during streamed updates.

v3 documents DOM-wins hydration, equal-write avoidance, and composition-aware writeback. Those are runtime capabilities to use, not a reason to remove the application's Enter guard. Keep composition-start/end tracking, native `isComposing`, and the appropriate legacy 229 guard. Enter sends only outside composition; Shift+Enter remains a newline. Escape closes the active dialog, never cancels a run or discards a draft.

The runtime explicitly distinguishes synthetic composition coverage from a real Japanese IME test. The local matrix still includes Android/Samsung Japanese input with an external keyboard, mobile virtual keyboards, and Safari/iOS. Test an incoming checkpoint while a composition and textarea selection are active. A passing synthetic test is not device certification.

## 6. Small mobile chooser adaptation

The preserved prototype uses a native select for mobile skill navigation. **Do not port its changing skill options as a reactive native select.** The tagged v3 forms contract requires static select/optgroup/option structure and static option labels.

The production decision is a compact button displaying the current skill, opening a native dialog with a keyed list of skills. It keeps the quiet mobile layout but supports added, renamed, and restored skills without replacing a focused select. Selecting a row updates the current skill, closes the dialog, and returns focus to the trigger. The initial list may be simple buttons with an explicit current-item indicator; do not claim listbox semantics without implementing its keyboard contract.

A fixture scenario selector whose option set is fixed can remain a native select with a writable model. Avoid reconstructing native selects on every update as a workaround.

## 7. Build isolation and reuse

zfb v3 emits a shared island bundle for a project. Separate pages inside one project do not imply separate client code graphs. Keep the public mock showcase separate from any private/live frontend build. Ordinary conversation components and provider-neutral core/client contracts may be shared; public entries must not import private adapters or credentials.

Do not import a React viewer from History Stash directly into this zudo-react tree. Reuse or port its runtime-neutral versioning semantics only after verifying the chosen distribution. Do not import a zudo-doc preset until that exact preset is proven v3-compatible. Plain repository Markdown is sufficient for initial handoff/setup documentation; an incompatible docs theme must not stall the mock application.

User/agent message text remains untrusted content. Render safe text or sanitized Markdown; do not compile a conversation as executable MDX or pass untrusted HTML directly to `rawHtml`.

## 8. Updated order of work

**P0:** exact install/export/binary checks; one real island; authored CSS; writable textarea; keyed update; native dialog; hydration/cleanup evidence. This is an implementation proof, not a pending release decision.

**P1:** port the same standalone, embedded, and Skills surfaces; adapt the mobile chooser; replace full-root rendering; implement the same client contract in the mock; pass stateful browser regressions.

**P2–P5:** unchanged: local D1 history/skills, durable fake runs/reviewed effects, context/cache/operations, and recipe packaging plus separately authorized live-provider work. The v3 release does not remove any backend failure-injection gate.

Do not claim the existing prototype's 61 checks as zfb 3.0.0 checks. See document 05 for the new frontend matrix and `../UPDATE-VERIFICATION.md` for what was actually checked during this plan update.

## Tagged primary sources

- [Release](https://github.com/Takazudo/zudo-front-builder/releases/tag/v3.0.0) and [tag identity](https://api.github.com/repos/Takazudo/zudo-front-builder/git/ref/tags/v3.0.0).
- [SDK manifest](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/packages/zfb/package.json) and [runtime manifest](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/packages/zfb-runtime/package.json).
- [Migration](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/docs/src/content/docs/guides/migrating-to-v3.mdx).
- [Hook migration / component patterns](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/docs/src/content/docs/zudo-react/coming-from-preact-hooks.mdx).
- [Forms, composition, and select limits](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/docs/src/content/docs/zudo-react/forms.mdx).
- [Islands, transport, and shared bundle](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/docs/src/content/docs/concepts/islands.mdx).
