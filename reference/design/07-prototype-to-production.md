# 07 · Prototype shortcuts to replace

The prototype is intentionally portable and small. Reuse its information architecture, state distinctions, interaction intent, authored design tokens, and deterministic scenario coverage. Do not mistake its implementation shortcuts for production architecture.

| Prototype behavior | Production replacement / required proof |
| --- | --- |
| One self-contained HTML, plain DOM rendering | zfb shell plus stable zudo-react components; verify the pinned major's actual APIs |
| Whole application `innerHTML` rerender with text escaping | Keyed message/component regions, safe Markdown, stable focus/IME/selection/disclosures/scroll |
| `getSnapshot()` reads all mock state synchronously | `ConversationClient`, validated API responses, consistent server snapshot, paginated projection |
| Metadata activity events such as `message.created` | Production discriminated entity-upsert protocol in `contracts/domain.ts` |
| Browser-local synthetic arrays/storage | Canonical scoped D1 repositories and durable runtime state |
| In-tab `setTimeout` generation | Bounded queue consumer steps, outbox repair, claim fencing, persisted checkpoints |
| Reconnect pauses view while the same page continues | Actual disconnected client reconnecting to independently running backend; replay/resync proof |
| Browser reload cancels outstanding mock timers | Backend continues/recoveries independently; client reattaches to retained state |
| Apply completes immediately in memory | Approval accepted → applying → confirmed host receipt, with ambiguous result handling |
| “Saved in this browser” | Durable acceptance status, distinct unsent draft and failed-send state |
| `JSON.stringify` used for mock request equality | Runtime-normalized canonical payload hashing + scoped command receipts |
| Local mock `retry` also handles conflict refresh | Separate retry-versus-refresh commands and distinct input snapshot policy |
| Numeric mock resource revisions and one current proposal | Host-owned revision/absence contract and retained immutable proposal history |
| All three mock skills pinned automatically | Versioned assistant configuration selecting allowed skills/tools/provider policy |
| Plain synthetic text and small JSON export | Sanitized text/Markdown and bounded, authenticated export/history pagination |
| Character-count guards | Server-side UTF-8 byte limits, exact schemas, response-size limits |
| No auth/secrets | Host session resolution, scoped repository authorization, private service boundary |
| No quota, retention, reconciliation UI | Explicit server policy, operator procedures, unresolved-effect safety gate |
| Simplistic line-membership skill comparison | Tested text diff supporting repeated/reordered lines and complete change disclosure |
| Basic viewport and Escape checks | Actual touch/IME/Safari/Android/accessibility validation |

## Important mock limitations

The prototype keeps only a single current proposal pointer per conversation. Old proposal-related activity remains in its simple event list, but it does not maintain a full independently inspectable historical proposal collection. Production must retain each proposal, exact payload, decision, and receipt in its own record.

The default preview is explicitly an **excerpt**. View exact changes reveals the complete stored synthetic body. Production must ensure the review representation derives from the exact immutable action being approved; neither model-authored prose nor a shortened preview alone is proof of the actual write.

For the v3 port, document 08 is authoritative about writable form models, live signals versus snapshots, keyed regions, JSON-only island props, and the mobile skill chooser adaptation. The original screenshots are not evidence that those v3 components have already been built.

The mock page renderer may rebuild DOM nodes on a service notification. It protects common draft/scroll behavior for review, but production must use stable keyed nodes. Do not extend the prototype renderer into a high-frequency production chat renderer.

The public mock uses only synthetic data and has no runtime secrets. Do not add real credentials to make one showcase interaction work. A model failure in live mode must remain an error; it must not silently use the mock response and claim successful live work.

## Reuse map

`prototype/src/styles.css`: bring over design tokens and component styles, then adapt selectors to real component boundaries. Keep native authored CSS with `wind: false` on the selected zfb 3.0.0 baseline; utility conversion is not required.

`prototype/src/core.js`: extract fixture stories and expected outcomes. Port operations to the finalized `ConversationClient`; retain unit test intent, replacing mock-only assumptions with repository/fake-provider interfaces.

`prototype/src/app.js`: use as behavior/reference code, not a production drop-in. The global `__CONVOS_DEMO__` is test instrumentation and must not be shipped in a live build.

`contracts/domain.ts`, `client.ts`, and `event-projector.ts`: a coherent proposed production boundary. Typechecked and projection-tested here, but runtime validators and the full HTTP/backend adapter remain local work. Add paging/export signatures and any finalized errors without silently changing event semantics.

`schema/001_initial.sql`: validated local syntax and selected constraints. Prove transaction guards, migrations, claim concurrency, event consistency, and binding behavior in real local D1 before treating it as the application's database contract.

## Promotion checklist

Before calling a surface production-ready, verify that it no longer uses synthetic completion facts, fake timestamps/metrics, fixed model responses, client-authoritative permissions, the in-page run scheduler, unbounded full-history clones, mock request hashing, or metadata-only event replay. Retain a separate mock-only build so the recipe remains explorable without accounts or paid calls.
