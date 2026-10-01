# 01 · Product scope and implementation plan

## The product to build

A reusable zfb recipe for applications that need several ongoing AI conversations, retained conversation logs, versioned instructions, and reviewable agent actions. The standalone viewer is useful in its own right, but it should not dictate the host application's data model.

Issue #1 supplies three motivating CMS tasks: prepare a release page, update company information, and change an inquiry email address. They are **demonstrations of the interface**, not a requirement to build a general CMS. The issue also requests backend storage/cache, skill-like version history, an API, and a mock-only public showcase. MCP is a possible later interface; a CLI is not the core deliverable. Source: [issue #1](https://github.com/Takazudo/zfb-example-agent-convos/issues/1).

## Proposed first-release boundary

Ship multiple conversations with titles, search, archive/restore, message history, streaming progress, retry/cancel/reconnect states, and JSON export. Ship text-based skills with immutable versions, history, a trustworthy diff, restore-as-new-version, and run-pinned revisions. Ship one explicit approval workflow for one resource-changing tool call at a time. Ship a standalone example and a very small embedded CMS example sharing the same conversation component/controller.

The runtime retains the accepted user request, selected context, run state, proposals, decisions, and safe tool receipts. The host supplies identity, access checks, resource revisions, executable tools, and any provider credentials. The sample should work through a mock client with no account, then through a locally emulated Worker and fake model, before a real model is considered.

**Defer:** attachments and large binary storage; collaborative thread editing; message-edit branching; vector search; autonomous parallel agents; arbitrary code execution; a visual workflow builder; model shopping UI; user-managed API keys; a complete CMS; MCP; package publishing; deletion/erasure UI. These can be extensions without distorting the core recipe.

## Core distinctions

| Distinction | Product consequence |
| --- | --- |
| Conversation versus run | One request may have multiple attempts. A retry is visible without duplicating the user message. |
| Retained log versus model context | Long histories remain viewable even when a bounded subset/summary is sent to a model. |
| Saved versus finished | Acceptance is shown only after storage succeeds. Running, review pending, failed, and completed are separate statuses. |
| Skill versus tool | Skill text guides behavior; a host-owned tool registry and permission check authorize effects. |
| Proposal versus applied change | An assistant reply is not proof that a website changed. A host receipt is. |
| Archive versus delete | Archiving hides a thread and is reversible. No erasure promise is made. |
| Mock versus local backend versus live | Each tier has different evidence. The public example never silently calls a model. |

## Decisions recommended by this handoff

**Keep the primary UI quiet.** A conversation list, transcript, review cards, and composer are sufficient. Run/context/events live behind Details. Skills are a separate workspace surface rather than a technical panel beside every message. Two permanent sidebars are avoided on mobile.

**Own a small domain contract.** Use typed commands and a stable, versioned event envelope. Put providers and host tools behind adapters. Do not let a provider's session identifier become the application's conversation identity.

**Use D1 as canonical storage.** Use queue-backed bounded steps and a durable outbox for execution. Use cursor polling for live progress initially; transport sophistication can be added without changing state authority. KV is optional for immutable derived content, not correctness. The reasons and platform sources are in documents 02 and 06.

**Use the stable zfb 3.0.0 release.** The version decision is now settled: GitHub latest is v3.0.0, tag commit `8219310917c4e697a5c9eb292bd68b4ae7a7cefc`. Pin the CLI/SDK and runtime to `3.0.0`, use bundled zudo-react, and transfer the prototype as authored CSS with `wind: false`. P0 verifies installed artifacts and a real build; it no longer waits for a release/prerelease/local-build decision. npm dist-tags and installation were not verified here. Sources: [release](https://github.com/Takazudo/zudo-front-builder/releases/tag/v3.0.0), [tagged migration guide](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/docs/src/content/docs/guides/migrating-to-v3.mdx). See document 08 and the stack lock.

These are proposed defaults. The local agent should implement them unless the owner selects a different documented tradeoff; it should not silently redesign the product.

## Proposed repository shape

This is a target tree, not a description of files already in the repository.

```text
apps/
  showcase/                 # zfb site, recipe docs, standalone + embedded examples
    components/convos/      # zudo-react conversation surface
    client/                 # view store, commands, draft/scroll/focus state
    styles/                 # authored CSS and tokens
    worker/                 # same-origin gateway in non-public-live mode
packages/
  core/                     # domain types, validators, state transitions, limits
  client/                   # typed HTTP client and event projector
  mock/                     # deterministic scenarios through the SAME client port
workers/
  conversations/
    src/api/                # private command handlers / internal dispatch
    src/db/                 # scoped repositories + transaction helpers
    src/execution/          # claims, queue consumer, outbox repair, checkpoints
    src/providers/          # fake provider; live adapter added separately
    src/tools/              # host tool ports, no concrete CMS coupling
    migrations/
tests/
  contract/                 # same behavior against mock and local Worker
  integration/              # D1, queue/outbox and host-adapter failure injection
  browser/
docs/                       # setup, architecture, embedding, operations, recipe
scripts/                    # deterministic seed, b4push, local smoke
```

The number of packages can be collapsed during P0 if pnpm overhead outweighs value; preserve dependency direction, not empty folders. Do not turn this into a generic framework before the two example consumers prove the seams.

## Milestones and completion gates

### P0 — Install the pinned v3.0.0 baseline and prove one island

Re-read issue and repo instructions; preserve any intervening local work. Install exact `@takazudo/zfb@3.0.0` and `@takazudo/zfb-runtime@3.0.0`. The release/tag identity is already verified; registry availability, installed tarball exports, and the local executable are the remaining checks. Use `scripts/verify-zfb-v3.mjs` from the handoff against the showcase directory, and record actual tooling in `docs/stack-lock.md`. Do not add the Cloudflare SSR adapter to a static-shell project merely because the backend uses Workers.

Build one static page with a named `"use client"` root wrapped in `<Island when="load">`. Use authored CSS with `wind: false`, the v3 JSX import source, and no old framework/Tailwind config. Prove a writable textarea model, a live derived label, a keyed message update, a conditional region, and a native dialog. Check pre-hydration typing, a synthetic composition cycle during incoming updates, cleanup on unmount, and truthful hydration failure diagnostics. Detailed acceptance checks are in documents 05 and 08.

Keep the first server/client setup deterministic. Load storage and establish the controller/subscriptions after activation. The ordinary P0 gate needs no Cloudflare/model credentials. Establish formatting, strict typecheck, unit/browser tests, and b4push/CI; pin Actions by SHA when adding CI.

**Exit:** actual package/export/binary checks + `zfb check` + `zfb build` + v3 browser smoke, with versions and evidence recorded. Release availability is resolved, but these implementation checks are not yet PASS. A dependency-free prototype test is not this gate.

### P1 — Port the mock UX and finish the production client contract

Implement reusable conversation/controller components, preserving the two prototype layouts and the Skills surface. Replace root `innerHTML` rerenders with stable keyed regions. Build runtime validators for the proposed domain and `ConversationClient` routes. Implement the mock through that exact port, with fake clock/IDs and deterministic event sequences.

Preserve the seven review scenarios, per-thread drafts, IME-aware entry, safe text/Markdown rendering, explicit saved/run states, and mobile drawers. Apply the v3 port rules in document 08: keyed message and proposal identity, writable composer model, owned async cleanup, and the compact mobile skill chooser/dialog replacing dynamic native-select options. Extract the sample host adapter; do not keep CMS resource paths in core.

**Exit:** one browser suite runs standalone and embedded against the same mock client; normal screenshots and failure states match the prototype's intent; no global diagnostic store is required by UI code.

### P2 — Retained history and skill revisions on local D1

Implement scopes/ownership, conversations, messages, revisions, event pages, skill histories, and consistent snapshots. Validate the candidate migration against actual local D1. Add guarded transaction helpers: a failed compare-and-set condition must roll back every associated write. Implement scoped command receipts, immutable skills and context inputs, bounded pagination, and archive/restore.

Start with a locally configured synthetic principal. Production auth is a host integration point, not an unauthenticated default. The local principal must be impossible to enable accidentally in a public live deployment.

**Exit:** contract suite passes against mock and local Worker. Restart the local runtime; history and skills survive. Cross-user/workspace reads, exports, event cursors, and decisions are denied. No real provider calls.

### P3 — Durable fake runs and reviewed effects

Implement atomic acceptance, outbox dispatch/repair, queue claims, generation fencing, periodic text checkpoints, cancellation, retries, and proposal creation. Implement approval as durable acceptance of one immutable proposal, then queue host execution. Add a fake host with an idempotent effect ledger and atomic resource revision checks.

Test the failure windows: D1 commit before queue send; queue send before dispatch receipt; duplicate delivery; claim expiry; a late abandoned worker; approval conflict; request disconnect; and a host effect succeeding before its receipt reaches the recipe.

**Exit:** a closed/reopened browser catches up without duplicate messages; fake runtime restart preserves accepted intent; unknown side effects are quarantined for reconciliation; no test needs a model credential.

### P4 — Context policy, cache seam, and operations

Define one assistant configuration, bounded context selection, summary coverage markers, resolved skill pins, provider/tool policy versions, and a manifest hash. A failed generation retry reuses the original snapshot; a stale-proposal refresh takes a new one. Add content-addressed caching only if a measurable need exists; correctness must be identical with cache disabled.

Document quotas, retention, archive semantics, provider deadlines, outbox alarms, dead-letter handling, kill switch, exports, and redacted diagnostics. Mark unmeasured token usage/cache savings as unknown.

**Exit:** a skill edit cannot change an in-flight run; injected cache misses/stale heads cannot change correctness; operator can diagnose stranded work without inspecting secrets or hidden model reasoning.

### P5 — Recipe packaging and optional live adapter

Finish the zfb recipe documentation, setup guide, embedding example, local seed, test commands, and architecture diagrams. Add one provider adapter behind server configuration only. Choosing its model/version and enabling a real inference test are explicit operator decisions.

Public build: mock-only with no live binding, no credentials, no query-parameter switch to a live API. Private/local live build: host-authenticated and scoped, quota-limited, with the kill switch working. It must not convert a model failure into a fake success.

**Exit:** another small host can integrate through the documented auth/tool/client seams without importing the mock CMS; all verification tiers are labeled; the target repo has a runnable zero-account showcase and honest local/live instructions.

## Definition of done

The recipe is complete when history survives runtime restarts, duplicated requests and work delivery do not duplicate visible turns or confirmed effects, stale approvals cannot overwrite current host data, accepted runs are reproducible from immutable inputs, and the same UI works in both layouts without a real model. A screenshot alone, a happy-path demo, or a successful model response is not sufficient evidence for the backend promises.
