# Local implementation prompt

Implement issue #1 in `https://github.com/Takazudo/zfb-example-agent-convos` using this handoff directory as a reviewed starting proposal.

Read `START-HERE.md`, `UPDATE-v3.0.0.md`, all eight numbered documents, `docs/stack-lock.md`, `schema/schema-notes.md`, and the source files under `contracts/` and `prototype/src/`. Open the HTML and review the screenshots before porting the UI.

## Establish the baseline before writing application code

Inspect the current repository, its instructions, and issue #1. It was empty during the 2026-09-29 review, but do not assume it still is. Do not overwrite unrelated work.

Use the released **zfb 3.0.0** baseline. Pin `@takazudo/zfb` and `@takazudo/zfb-runtime` to exactly `3.0.0`; zudo-react is bundled through `@takazudo/zfb/zudo-react`, not a separate renderer package. GitHub tag `v3.0.0` resolves to `8219310917c4e697a5c9eb292bd68b4ae7a7cefc`. The previous prerelease/local-build decision is obsolete. Read the tagged v3 sources in document 08; keep house tooling conventions but do not copy an old Preact/Tailwind scaffold. Verify the registry artifacts, installed exports, and local binary, then run a real build/browser smoke. `scripts/verify-zfb-v3.mjs` assists the installed-toolchain check. Record commands, lockfile, exact Node/pnpm/TypeScript/Cloudflare tool versions, and results in `docs/stack-lock.md`. Do not silently float to another version or fall back to v2. Installation problems are environment/artifact problems to report, not a reason to reopen the settled design choice.

## Scope and sequence

Follow phases P0–P5 in `docs/01-product-and-plan.md`. Complete the mock UI and contract work before enabling live inference. Keep the conversation surface reusable, with a standalone showcase and a minimal CMS-embedding example using the same component/controller.

Use authored CSS/design tokens from the prototype with **`wind: false`** and an explicit authored reset. Set `jsx: "react-jsx"` and `jsxImportSource: "@takazudo/zfb/zudo-react"`. Delete `framework`, `tailwind`, Tailwind directives/imports, and old JSX aliases. Use setup-once zudo-react components and native signals/events/models, not React/Preact hooks. Do not add Vite, React, Tailwind, Flue, or the Agents SDK merely because older references used them. A small Hono Worker boundary is consistent with the house stack; the zfb static site remains the frontend build.

Implement canonical D1 conversation/event/run/proposal/skill storage, immutable skill pins and input snapshots, scoped idempotency, one active run per conversation, outbox repair, queue claims with fencing, and host-authorized review/apply semantics. Cursor polling is the initial live event transport. No correctness dependency on KV, a browser stream, or `waitUntil` alone.

The supplied mock is **not** the proposed HTTP client implementation. Port it to `ConversationClient` and the discriminated production events; do not copy its internal full-state snapshot access into production UI. The proposed SQL is a starting migration, not an already validated D1 adapter. Implement and prove atomic guard semantics against real local D1.

## Non-negotiable behavior

- Never accept scope, actor identity, host resource authority, or executable permissions from client-supplied metadata.
- Scope every read, export, event page, proposal decision, and skill operation. Use the host's authenticated principal and permission resolver.
- Persist acceptance and its outbox record before acknowledging a user request.
- Retry a failed generation as a new run against its retained input snapshot, with no duplicate user message. Refreshing a stale proposal is a separate operation with fresh context.
- Approve an exact immutable proposal hash and recheck the host revision atomically with the external write. No silent rebase.
- A timed-out write is not necessarily a failed write. Require a host idempotency receipt/reconciliation capability before enabling it. Unknown outcomes enter `needs_reconciliation`, without blind retries.
- Editing/restoring a skill appends a revision. Accepted runs keep their original pins. Skill text cannot grant itself a tool.
- Preserve archive-versus-delete terminology. Do not promise erasure; deletion is out of scope for the first recipe.
- Keep real credentials out of messages, prompts, events, screenshots, fixtures, and ordinary logs.
- Public showcase = mock-only build, no live model binding and no route that can switch it into live mode. Live verification is a separately authorized operator action.

## Validation and completion

Run and adapt the supplied tests. Add the backend failure-injection matrix in `docs/05-validation.md`, including cross-scope isolation, duplicate queue delivery, D1/queue dual-write recovery, claim expiry, stale approvals, ambiguous host effects, and replay gaps. Add real Android and Safari/mobile keyboard checks; the supplied screenshot viewports are not device evidence.

Port the prototype's whole-root render to stable keyed components. Follow document 08: pass live signals rather than `.value` snapshots into JSX, use `For` keyed by durable IDs, keep the composer mounted during checkpoints, and bind its writable draft via `modelValue`. Start browser work in `scope.onActivate`, own subscriptions/polling with scope cleanup, and cancel or ignore stale requests when switching conversations. Preserve focus, textarea composition/selection, transcript scroll anchors, open disclosures, and pending requests while events arrive.

Use a compact button plus native dialog with a keyed list for the mobile skill chooser: v3 does not support reactive select options. Use native dialogs, not React portals. Keep all runtime client instances, callbacks, and signals inside the client tree; the Island boundary receives only JSON-safe, public bootstrap props. Build the public mock and any private client from separate source/build graphs, since zfb shares one island bundle across a project. Do not let a second page import live code into the mock artifact.

Finish with a runnable mock showcase, zero-model-call local backend path, setup/operations/recipe documentation, pinned toolchain, tests, and a b4push task matching CI. Report exact commands and results. Distinguish mock tests, local D1/queue emulation, and opt-in real provider evidence.

Do not deploy, provision paid resources, enable public live inference, publish packages, push commits, close issue #1, or rewrite another repository unless separately requested. Pause only for genuinely missing credentials or decisions; continue independent mock/backend work where possible.
