# 05 · Validation and release gates

## Evidence produced in this conversation

The bundle contains a working dependency-free prototype, executable mock-service logic, a proposed production event projector, TypeScript contracts, and a candidate SQL migration. It is not a built zfb application, a Cloudflare runtime, or a verified CMS integration.

The original 2026-09-29 run results are recorded in `TEST-RESULTS.md` and raw reports under `tests/`. The v3 plan-update evidence is recorded separately in `UPDATE-VERIFICATION.md`; neither set establishes a real zfb 3.0.0 build. Node tests exercise synthetic in-memory state and storage adapters. Browser tests exercise rendered HTML using Chromium/Playwright. SQLite tests exercise syntax and selected constraints in Python SQLite. None of these substitutes for actual D1/queue binding behavior.

The environment's Chromium URL policy blocked both direct file navigation and localhost navigation. Rendering and interaction were tested through `page.set_content` with the self-contained HTML. This allowed offline UI verification without bypassing the navigation policy. Browser storage used the explicit session-only path in those checks; persistence is separately covered with an injected in-memory storage object in Node. Opening the downloaded HTML in a normal browser and reloading real localStorage remain local smoke checks.

## Verification tiers

| Tier | Model/network policy | What it must prove |
| --- | --- | --- |
| Pure core/unit | No model or network | Validators, transitions, exact pins, projection/deduplication, command identity |
| Browser mock | No model/API credentials | Workflows, rendering, mobile layout, focus, IME, draft/scroll behavior |
| Local Worker integration | Local D1/queue/host fakes only | Actual database transactions, bindings, persistence, lease/outbox/effect failures |
| Private live smoke | Explicit opt-in and scoped credentials | Real provider/tool shape, timeouts, observed usage, deployment configuration |
| Public showcase | Mock-only | No reachable or accidentally enabled live inference path |

A skipped live smoke is a useful ordinary development result, but must not be counted as a successful live readiness gate. A real model returning text does not prove safe apply or durable recovery.

## P0/P1: v3.0.0-specific frontend gate

These are local implementation gates, **not results claimed by the preserved plain-HTML prototype**.

| Check | Required observation |
| --- | --- |
| Installed toolchain | SDK/runtime package manifests, required export paths, and the actual local CLI all identify 3.0.0; commit the package lock |
| Removed dialect | No `framework`, `tailwind`, Tailwind directives, old JSX aliases, or React/Preact hook imports in the showcase graph |
| True live bindings | Text and attributes update through signals/computed values without rerunning root setup or rebuilding the transcript |
| Keyed identity | Same-ID message replacements preserve DOM, details state, selection, and scroll anchors; no timestamp/content keys |
| Model hydration | Text entered before activation survives; restoring a stored draft must not overwrite a DOM edit |
| Composition | Synthetic composition plus incoming checkpoints produces no textarea writeback or Enter submission during composition; real Japanese IME remains a separate device gate |
| Thread changes | Old polling/subscriptions abort or are ignored by generation; new-thread data cannot be overwritten by a stale response |
| Dialogs | Native dialog lifecycle, Escape, focus return, and inert background work on narrow and wide layouts |
| Mobile skills | Add/rename a skill while the chooser is open; the keyed dialog list updates without a reactive native select |
| Hydration failure | Broken/mismatched island input does not falsely show mounted/saved/connected state; the surrounding page remains usable |
| Public bundle | Mock and private source/build graphs are separate; the mock build has no reachable live adapter or secrets |

Use the tagged release docs in document 08 as the runtime contract. In particular, synthetic composition evidence does not certify a real Samsung/Japanese IME session.

## Required local backend test matrix

### Acceptance, isolation, and transactions

- Send the same command key twice sequentially and concurrently; assert one accepted user message/run and the same logical receipt. Change the payload under the same key; assert conflict.
- Race two different send commands for one conversation; assert exactly one active run is admitted.
- Inject a failure after each statement in acceptance; assert message, manifest, run, pins, events, receipt, and outbox are either all committed or all absent.
- Exercise a failed CAS predicate; assert it aborts the batch, not just the first update.
- Attempt every route with another actor/workspace/tenant/resource association, including events, context, export, skill versions, run IDs, and proposal IDs. Assert denial without data leakage.
- Forward forged browser identity/capability headers to the gateway; assert they do not affect authority. Test missing auth, revoked permission, CSRF/origin policy, and disabled live mode.

### Queue/outbox/runtime failures

- Commit acceptance, crash before queue publication, run the repair pass, and prove the work is eventually claimed once visibly.
- Publish a queue item, crash before marking outbox sent, then republish; assert duplicate delivery cannot create a second visible response/effect.
- Expire a run lease while a fake provider is delayed. Let a successor claim the run, then deliver old output. Assert the old generation cannot commit.
- Restart the local Worker with accepted work pending. Reopen the thread and verify durable queued/run state, not an empty in-memory placeholder.
- Exercise provider timeout, bounded retry exhaustion, oversized output, malformed tool call, and output checkpoint failures. Preserve partial accepted content and safe error state.
- Kill the browser mid-run, continue the fake backend independently, and reconnect from the last observed cursor. This is the backend durability test that the prototype's in-tab reconnect simulation cannot provide.

### Approval and ambiguous effects

- Approve the exact current proposal twice, under both the same and a different command key. Assert one effect key and one host effect.
- Change the host revision before approval or between approval acceptance and execution. Assert atomic host CAS rejects the stale write.
- Change proposal arguments or hash in transit; assert rejection. A model must not be able to swap reviewed arguments after the user approves.
- Revoke actor permission after approval acceptance but before execution. Assert host execution rechecks authorization.
- Crash after the host effect commits but before the recipe receives its receipt. Reconcile through the effect key and avoid another write.
- Simulate an unknown result that cannot be reconciled. Assert `needs_reconciliation` blocks unsafe retries and further active work.
- Request cancellation during generation and applying. Assert “request received” does not masquerade as “no effect happened”; already committed work is not undone silently.

### History, skills, and context

- Race two editors against the same skill head. Exactly one revision wins; the other gets a visible conflict.
- Restore an older body and prove a new head is appended. Old revisions and accepted run pins remain unchanged.
- Update a skill during generation/review, then retry the failed generation. Retry uses the retained original snapshot. Refreshing a stale proposal uses fresh context and a new proposal identity.
- Build snapshots under concurrent event writes; prove entities and `throughEventSeq` correspond to one cut.
- Replay duplicated/out-of-order pages, missing sequence ranges, unsupported schemas, and expired cursors. Deduplicate or resync; never silently skip.
- Page long histories and exports without exceeding configured response-size/memory limits. Enforce an event-page byte cap as well as a row-count cap.
- Disable the optional cache, return a stale/missing blob, or change a skill head. Canonical correctness is unchanged. Cache telemetry and provider usage stay unknown when unmeasured.

## Browser/device matrix to add locally

Test standalone and embedded surfaces at phone, tablet, and desktop widths. Use an actual Android browser and Safari/iOS session for virtual-keyboard opening, blur/tap scrolling, safe areas, resize handling, and screen-reader focus. Synthetic `isComposing` events here exercise the guard but are not a Japanese IME device test.

During a streamed update, keep a textarea selection, an expanded change diff, an open details drawer, and an older-message scroll anchor stable. Prepend older history while reading; do not jump to the newest item. Restore focus after dialogs and after resolved proposal buttons disappear. Test reduced motion, 200% text zoom, long titles/paths, RTL/unbroken content where supported, and system font fallback.

Test HTML/script-like input, unsafe Markdown links, oversized code fences, and tool output. No untrusted content may create executable markup. Add an accessibility audit and keyboard-only journey; the current browser checks are not an accessibility conformance certification.

## Public mock and private live configuration

Prove the public artifact cannot call a model even with crafted query parameters, modified localStorage, direct endpoint requests, or a hidden UI control. Public routes/bindings must not include live credentials or an enabled runtime by default. Do not use a secret embedded in browser JavaScript as the protection.

For a private live smoke, record the exact toolchain, commit, provider/model configuration, timeout, and observed result/usage. Use a safe synthetic prompt and a fake or sandbox host tool. Do not deploy/provision public resources or call a paid provider without authorization. Keep provider keys in server secrets, not command arguments, logs, or event fixtures.

## CI and local completion

After P0, make b4push mirror CI's deterministic checks: formatting, strict types, unit/contract tests, local binding integration, browser mock checks, build, and deployment dry-run where supported. Pin tool and Action versions. Real provider calls are opt-in, not ordinary CI dependencies.

A release report must distinguish PASS, FAIL, SKIPPED, and NOT RUN. Retain regression evidence for each durable boundary. Do not replace a failed durability test with a screenshot or a successful UI click.
