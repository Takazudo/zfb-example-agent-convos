# 06 · Reference audit and provenance

Original research date: **2026-09-29**. zfb release/API recheck: **2026-09-30 (Asia/Tokyo)**. Sibling/platform sections below retain their original review dates; this revision does not imply those projects were re-audited. GitHub was read through the connected GitHub tools. Platform behavior was checked against official Cloudflare documentation. This is a scope-of-review record, not a claim that every referenced repository was audited in full.

## Requirements and starting point

| Source | What was inspected | What it contributes |
| --- | --- | --- |
| [Target issue #1](https://github.com/Takazudo/zfb-example-agent-convos/issues/1) | Complete issue body; open, no comments at inspection | Multiple agent conversations; Worker-backed logs/cache; skill-like version history; API; mock public showcase; CMS examples without CMS coupling |
| [Target root contents](https://api.github.com/repos/Takazudo/zfb-example-agent-convos/contents/) | Directory response was empty; repository search reported size 0, default branch main | New project plan; no existing UI/component structure to preserve |
| [House Cloudflare app skill](https://github.com/Takazudo/claude-settings/blob/main/skills/dev-basic-cloudflare-webapp/SKILL.md) | Complete guide; modified 2026-09-21 | Cloudflare, pnpm, strict TypeScript, Hono/Worker boundary, testing/build conventions; framework portions must be reconciled with newer zfb guidance |

## zfb release discrepancy — resolved by stable v3.0.0

The fresh [latest-release response](https://api.github.com/repos/Takazudo/zudo-front-builder/releases/latest) identifies **v3.0.0**, with `draft: false` and `prerelease: false`. Publication: **2026-09-29T15:28:59Z**, or **2026-09-30 00:28:59 JST**. The [tag reference](https://api.github.com/repos/Takazudo/zudo-front-builder/git/ref/tags/v3.0.0) resolves directly to commit **`8219310917c4e697a5c9eb292bd68b4ae7a7cefc`**.

The release lists binary assets, including macOS arm64 and Linux arm64, with SHA-256 digests. Asset listing is not a download/execution test. Tagged [SDK package metadata](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/packages/zfb/package.json) and [runtime metadata](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/packages/zfb-runtime/package.json) both declare `3.0.0`. The SDK exports `./zudo-react`, its JSX runtimes, and client/server subpaths; a separate renderer package is not required.

Freshly inspected tagged API documentation:

- [Migration](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/docs/src/content/docs/guides/migrating-to-v3.mdx): removed framework/Tailwind integration; `wind: false`; owned JSX runtime; no compatibility mode.
- [Hook migration](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/docs/src/content/docs/zudo-react/coming-from-preact-hooks.mdx): setup-once components, live bindings versus `.value` snapshots, `For`, `Show`, activation/effect cleanup, and explicit props instead of React Context/portals.
- [Forms](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/docs/src/content/docs/zudo-react/forms.mdx): writable `modelValue`, DOM-wins hydration, composition handling, static native-select options, and real-IME evidence limitations.
- [Islands](https://github.com/Takazudo/zudo-front-builder/blob/v3.0.0/docs/src/content/docs/concepts/islands.mdx): JSON transport, deterministic activation, the mounted marker, and a project-wide shared island bundle.

**Updated decision:** use stable **3.0.0** now. P0 is an installation/build/hydration proof, not a request to choose a prerelease or custom build. Follow document 08 and `stack-lock.md`.

**Remaining evidence gap:** npm `latest` metadata and artifact installation could not be independently checked. Browser web fetches of GitHub/npm documentation failed; the connected GitHub reads succeeded. Direct npm-registry requests from the container failed DNS resolution. No zfb installation, binary execution, or zfb browser build was run. GitHub tagged `package.json` contents do not prove the published tarball's exports; the local preflight explicitly checks them.

### Historical record (superseded, not an active gate)

The original September 29 review saw latest stable **v2.22.1**, published `2026-09-27T18:48:22Z`, while main tree `c5027a0b5a73628778e64734a26602f5e80ee70f` documented v3. That was the reason for the earlier availability caveat; the September 30 recheck resolves it. A rejected tags-list request in the original review was not evidence that v3 tags did not exist.

The originally read [AI summarizer recipe](https://github.com/Takazudo/zudo-front-builder/blob/main/docs/src/content/docs/recipes/ai-summarizer.mdx) identified its external sample as a v2.x Preact/Tailwind example. Reuse the zero-account distinction and Worker-context awareness, not those old package/config snippets. Other example repository names were discovered, not audited for v3 compatibility. The house skill's historical renderer choices do not override the tagged v3 contract.

## Sibling projects: reuse semantics, not entire implementations

### History Stash

Source: [README](https://github.com/Takazudo/zudo-history-stash/blob/main/README.md), read in full; modified 2026-08-29.

Observed: versioned text/binary storage using D1/R2, immutable history, compare-and-set/atomic change semantics, and restore-as-new-version behavior. It includes runtime-neutral parts and a React UI viewer. The README said packages were not yet published to npm.

Carry forward: immutable skill revisions, explicit head preconditions, approval against a fixed base, and restoration as a new version. Investigate reuse of its core/client only after verifying the local package/distribution path. Do not import a React viewer into a zudo-react UI, nor adopt binary/R2/multipart complexity for text-only skills. No deep source audit or package installation was performed here.

### zmod-bot

Sources: [README](https://github.com/zudolab/zmod-bot/blob/main/README.md) and [job state machine](https://github.com/zudolab/zmod-bot/blob/main/src/jobs/queue.ts). The queue source blob was `2fac02ec0a1b12f7a9daf33a84b78f11e0bdebd1`.

Observed: durable D1 intent before acknowledgement, immediate delivery as an optimization, scheduled recovery, explicit job states/leases/retries, injected fake I/O tests, and no real model calls in ordinary guards.

Carry forward: durable intent, repair, safe retries, and honest test tiers. Do not copy Slack-specific templates, command grammar, or its no-framework/no-DO decisions as universal requirements. The recipe's API and UI have different needs.

### zudo-pattern-gen

Source: [Composer assistant README](https://github.com/zudolab/zudo-pattern-gen/blob/main/workers/composer-assistant/README.md); code search identified the agent, contracts, worker, and retirement-outbox paths. The substantial README content was reviewed; the worker implementation was not exhaustively audited.

Observed: a private Cloudflare Agents runtime, authenticated host ingress/service binding, server-owned capabilities, bounded state and retention, and browser authority over Composer documents. Its pinned runtime/version details describe that specific integration, not a recommendation to install those versions now.

Carry forward: host/runtime boundary, ownership checks, stale approval fences, and deterministic safety tests. Do not copy short-lived Composer retention into permanent user conversation history, or assume every CMS should put document mutation authority in the browser.

### zudo-text

Sources: [README](https://github.com/zudolab/zudo-text/blob/main/README.md) and [Workers architecture/instructions](https://github.com/zudolab/zudo-text/blob/main/workers/CLAUDE.md), relevant sections read. The Workers file blob was `7b83c74f2b5df771f31007c18bcae1c03c59f006`.

Observed: multiple backend modes with a mock frontend; a Flue-based agent runtime behind authenticated ingress; server-created conversation mapping; credentials kept out of persisted model attributes; and an explicit warning that its delete route unlists/orphans rather than erases the Durable Object log.

Carry forward: swappable mock/live client, server-owned identity, credential isolation, and truthful archive/delete terminology. Do not reuse Flue-specific generated router/build behavior blindly or promise deletion semantics unsupported by a chosen runtime. Two generic code searches found no matches; the conclusions above come from the fetched documentation, not an inference of missing features.

### Slack wisdom

Source: [README](https://github.com/Takazudo/zudo-slack-wisdom/blob/main/README.md), read. It identifies a personal Slack/Cloudflare integration knowledge base.

No specific Slack API implementation is required for this recipe. Its deeper pages were not reviewed; this source creates no dependency or claimed technical proof.

## Official platform sources

| Source | Load-bearing fact used | Architectural implication |
| --- | --- | --- |
| [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) | At-least-once delivery; duplicates must be handled | Scoped idempotency, claims, and external effect receipts |
| [Worker execution context](https://developers.cloudflare.com/workers/runtime-apis/context/) | `waitUntil` has bounded post-response lifetime | Durable intent/repair cannot depend on it alone |
| [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/) | Eventual consistency and cached reads/negative lookups | Optional immutable cache only; not mutable approval/lock truth |
| [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) | Batch transaction behavior; session/bookmark semantics | Guard all related writes; start with primary reads; snapshots need a consistent cut |
| [Agents overview](https://developers.cloudflare.com/agents/) | Durable agent/session capabilities are available | A viable alternative evaluated, not falsely described as unavailable |

The additional outbox design, full-entity checkpoint protocol, schema layout, limits, and UX are recommendations synthesized for this issue. They are not copied platform guarantees. In particular, no platform document can guarantee exactly-once effects in an arbitrary external CMS that lacks an idempotent/transactional tool interface.

## Evidence boundaries

No target repository mutation, live model call, remote D1 test, deployment, package publication, or host CMS write occurred. No npm package version was guessed into a production scaffold. The downloadable artifacts are a runnable design/protocol handoff with explicitly separated local implementation gates.
