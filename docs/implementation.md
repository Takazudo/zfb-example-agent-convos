# Implementation boundaries and architecture

## Actual topology

```text
Native mock workbench                         Local SQLite workbench
  ConversationController                        same controller
    ConversationClient (memory service)           strict HTTP client
      MemoryRepository                              loopback Node HTTP server
      FakeProvider                                  injected synthetic principal
      DemoHost                                      ConversationService
                                                    D1Repository SQL statements
                                                    Node SQLite transaction adapter
                                                    independent fake-worker loop
                                                    persistent synthetic host receipts

Public zfb showcase
  zfb 3 static shell + zudo-react island
    same controller/client/service, memory-only import graph
    installed SDK/build/direct-browser hydration verified
```

The public showcase imports neither the HTTP client nor SQL adapter. No browser can switch that build into live-provider mode. The retained diagnostic native workbench uses a controlled, build-time-known AMD module loader. Both main UI surfaces now use the actual zfb renderer. It does not use eval or fetch dependencies dynamically, and it is not a replacement zudo-react engine.

`workers/conversations/src/worker.ts` assembles Cloudflare-compatible fetch/queue/scheduled handlers around injected ports. No actual Wrangler project, Worker resource, D1 database, or Queue was provisioned. The previous plan's separate gateway/private-worker deployment remains integration work.

## Acceptance transaction

`ConversationService.send` validates UTF-8 size, ownership/capability, archive state, optimistic conversation revision and the single-active-run invariant. It hashes the scoped operation/body for the caller's idempotency key. The repository commits the user message, immutable context snapshot and skill pins, queued run, ordered events, outbox item and accepted-response receipt together. A repeated key with equal input recovers its recorded outcome; a repeated key with different input is a conflict.

SQLite assertions use an INSERT into an assertion table whose CHECK constraint fails when a captured precondition is false. This makes an outdated base fail the **entire batch**, instead of incorrectly treating a zero-row UPDATE as a successful mutation. Real SQLite rollback has been tested; identical behavior must still be proved on D1's actual binding/runtime.

## Runtime and host effects

Jobs are leased with a generation, random claim token and expiration. Every checkpoint/final commit includes that unexpired fence plus an optimistic conversation revision. An old worker cannot write after another delivery takes ownership. Checkpoints retain complete bounded message parts, so the projector can ignore duplicates and detect missing sequence ranges.

The durable outbox separates acceptance from queue acknowledgement. A send/mark crash may duplicate delivery, but does not lose accepted intent. Sent records and active runs are eligible for repair after their deadlines. The fake runtime is tested through duplicate delivery, abandoned/expired claims, late results, cancellation and failures. Actual Cloudflare queue scheduling and acknowledgement semantics remain a separate gate.

A proposal hash covers the exact action, tool version, base revision and display. Approval is not a successful effect. The host checks permissions and expected revision atomically with its write and records an effect key. When a call's result is lost, the run enters reconciliation rather than assuming failure and issuing another write. The local SQL host proves persisted receipts across a full close/reopen. A production CMS must provide an equivalent atomic/idempotent contract.

The enabled flag in the Worker factory is an **admission gate**. It is false by default. It does not forcibly cancel a provider or external host mutation that has already started. Current authority is resolved before claiming work; host adapters must reauthorize their real resource at application time.

## Identity, content and credentials

The HTTP factory requires an injected authenticator. Conversation ownership and scope are rechecked on reads, writes, events, history, export and run/proposal references. Workspace skill operations additionally require the capability for the operation. The runtime resolves recorded work from the canonical outbox/run, rather than using a client actor as authority.

The local server's synthetic principal is not an authentication product. Its Host/Origin guards are defense in depth for loopback development, not a substitute for session verification in a public Worker. The browser storage adapter is also developer-only; host adoption must namespace/clear/encrypt drafts according to its account/session policy.

User/assistant text is rendered as text, not executable MDX or raw HTML. JSON request/response readers are bounded, protocol envelopes/entities are validated, and the HTTP layer does not expose internal database/provider exceptions. No provider token or production customer corpus is part of the fixture, event log or screenshots.

## UI ownership

The controller talks only to `ConversationClient`. It keeps drafts per conversation, fences async reads with an epoch, merges ordered events, requests a consistent snapshot after a gap, and persists command identity after an ambiguous transport failure. Disposing a view cancels local waits, not the durable server run. Only the explicit Stop action requests cancellation.

The native workbench keeps message/proposal nodes keyed by durable ID and keeps one textarea mounted. It preserves selection, composition guards, native diff disclosures and reader scroll anchors. Its mobile navigation and skill chooser use real dialogs. The zudo-react source expresses these responsibilities with live signals, writable models, keyed regions and scope-owned cleanup; direct browser coverage now verifies hydration, keyed updates, composition guards, native dialogs, scroll anchoring and local HTTP persistence.

## Deliberate differences from the old design bundle

- The originally suggested Hono boundary is currently a small native Request/Response router. Its routes, authentication injection and strict request/response handling are tested. It can be mounted behind a host Hono router without exposing a second authentication path.
- The candidate relational migration now has a repository implementation and Node SQLite tests. This does not convert those tests into D1 evidence.
- The public mock is memory-only; persistence is demonstrated separately with real local HTTP/SQLite.
- History paging and full retained JSON export are implemented client methods, not an internal snapshot escape hatch.
- The public mock and local HTTP UI use separate zfb build roots. Generated shared sources live beneath components/shared/ because zfb 3.0.0 omits ignored extra top-level directories from its build shadow. Staging rewrites NodeNext .js import suffixes for the project-local source graph.
- The actual zfb port is a separate source graph. The tested native workbench is not hidden inside a zfb wrapper and is not counted as hydration proof.

## Remaining limits and operations work

The recipe currently bounds one conversation to 128 runs and 256 messages, input to 16 KiB UTF-8, one skill body to 32 KiB, output to 16 KiB, context to 256 KiB, and event pages to 100 events / 256 KiB. Snapshot/history pages default to 50 messages. Those are initial engineering limits, not load-test results. Review the exported `LIMITS` object as the source of truth.

Conversation listing currently loads the scoped repository list before filtering/cursor slicing. SQL-level pagination, total workspace quotas and large-data load testing remain. Skills/history retention and permission changes during a long-lived view need host-policy integration. Expired reconciliation has repair but no fully developed operational escalation/backoff policy. Context selection keeps a bounded last-12-message snapshot; summaries, cache invalidation, retention/erasure, provider cost policy and operational metrics are not completed.

## Reference provenance

The issue and tagged v3 API were read through the GitHub connector. The implementation target is tag `v3.0.0`, commit `8219310917c4e697a5c9eb292bd68b4ae7a7cefc`. The relevant upstream sources are:

- `packages/zfb/src/zudo-react/index.ts`: signals, scope, For/Show and refs.
- `docs/src/content/docs/zudo-react/forms.mdx`: writable models, DOM-wins hydration, composition and static select limits.
- `docs/src/content/docs/concepts/islands.mdx`: JSON transport, mount marker and shared bundle.
- `docs/src/content/docs/guides/migrating-to-v3.mdx`: exact renderer/config transition.
- Cloudflare D1 `D1Database` documentation: batch transaction contract. Local SQLite evidence does not establish the actual D1 contract was exercised.

The original handoff and design screenshots remain in the prior conversation attachments; `reference/` keeps its HTML and design documents for comparison.

## Local zfb UI

`pnpm dev:local` builds both real zfb graphs and the core, then starts the loopback server. `/` serves the local HTTP island; `/mock` serves the static mock island. Only explicit generated assets and diagnostic pages are served. Path traversal, unexpected Host/Origin and cross-site requests are rejected. The local CSP allows same-origin zfb scripts/styles and inline scripts only for the retained native workbench; no external model endpoint is configured.
