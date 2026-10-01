# 04 · HTTP API and data contract

This is a proposed implementation contract. It is not a description of an existing API in the empty target repository. `contracts/domain.ts` and `contracts/client.ts` are the typed source; build runtime validators and an OpenAPI document from the finalized schemas during P1. Do not invent an OpenAPI file from a different provider's API.

## External HTTP boundary

Use same-origin `/api/v1`. The gateway derives the principal through the host auth adapter. Browser requests cannot set actor, tenant, workspace routing identity, or permission grants. Thread and skill identifiers are opaque handles, not authorization. Mutation requests require same-origin/CSRF protection appropriate to the host's session model, JSON content type, and exact bounded schemas.

The first recipe should avoid cross-origin credentialed browser calls altogether. HTTP clients for future MCP/CLI use a separately documented server authorization path; do not weaken the browser path for that possible extension.

| Method and path | Request / behavior | Successful response |
| --- | --- | --- |
| `GET /conversations` | `archived`, bounded `search`, opaque `cursor` | `200` list + next cursor |
| `POST /conversations` | Optional title; idempotency key | `201` conversation |
| `GET /conversations/:id` | Consistent snapshot, newest bounded message page | `200` snapshot + `throughEventSeq` |
| `GET /conversations/:id/messages` | Older-page cursor | `200` ordered page + next cursor |
| `PATCH /conversations/:id` | Expected revision; title and/or archived | `200` updated conversation |
| `POST /conversations/:id/messages` | Text + expected conversation revision | `202` accepted message/run/seq |
| `GET /conversations/:id/events` | `after` sequence, bounded page limit | `200` events + nextCursor + hasMore |
| `POST /conversations/:id/runs/:runId/cancel` | Idempotent cancel request | `202` current run |
| `POST /conversations/:id/runs/:runId/retry` | Failed/cancelled, no unresolved effects | `202` new run for original input snapshot |
| `GET /conversations/:id/runs/:runId/context` | Browser-safe context metadata | `200` context view |
| `POST /conversations/:id/proposals/:proposalId/decision` | Approve/reject + exact payload hash | `202` accepted decision state |
| `POST /conversations/:id/proposals/:proposalId/refresh` | Stale proposal, fresh context | `202` new run, no duplicated user request |
| `GET /conversations/:id/export` | Explicit authenticated export | `200` versioned JSON, attachment disposition |
| `GET /skills` | Workspace-scoped library | `200` names/descriptions/current heads |
| `GET /skills/:id/versions` | Paginated history | `200` immutable revisions |
| `GET /skills/:id/versions/:version` | Exact scoped version | `200` immutable revision |
| `POST /skills/:id/versions` | Expected head + body + note | `201` new revision |
| `POST /skills/:id/restore` | Expected head + source version | `201` newly appended revision |

The typed client covers the main UI operations. Older-message paging and streamed/large exports need a finalized transport signature during P1; the route descriptions here define their required behavior. The first prototype exports its full small synthetic snapshot, which is not the large-history export implementation.

Use `Cache-Control: no-store` for authenticated mutable responses and exports. Do not cache identity-sensitive responses at a public edge. Every mutation carries `Idempotency-Key`; reuse the same key after an ambiguous network failure for the **same command**. Generate a new key only for a distinct operation. AbortSignal aborts the client's wait; it is not the run-cancellation API.

## Envelopes and status codes

Use the `Result<T>` envelope from `contracts/domain.ts`; export attachments are the documented exception. Include an opaque request ID for troubleshooting, not raw stack traces. `202` means accepted, not completed. A repeated accepted command returns its original logical receipt; a separate snapshot reports the current run.

Authentication failure is `401`; lack of a permitted capability is `403`; unknown or inaccessible scoped resources use indistinguishable `404` responses where disclosure matters. Invalid shape/bounds is `400` or body-too-large `413`. Idempotency mismatch, stale revisions/proposals, and active-run conflicts use `409`. Quota limits use `429` with a meaningful retry policy; unavailable/disabled backends use `503` without pretending a fake model succeeded.

Cancel/retry/apply are not automatically safe just because they use POST. Look up the scoped command receipt first, compare canonical payload hashes, then enforce the current state transition and side-effect safety. Repeated approve with a different key must still hit the proposal/effect uniqueness fence.

## Write invariants

1. Scope all resources and relationship checks, not just the conversation list. A run ID supplied under another conversation must fail. A skill pin cannot refer to another workspace's revision.
2. Within one acceptance transaction, create the user message, immutable input manifest, queued run, pins, events, command receipt, and outbox. Nothing visible or runnable is left half-accepted.
3. The unique partial index permits one active run per conversation. Waiting review, cancel-requested, and reconciliation all occupy that slot.
4. Allocate event sequence numbers transactionally from the conversation row. Persist entity projection changes and their corresponding event envelope in the same transaction.
5. Skill restore creates a new revision with provenance. It never rewrites the old body, run pins, or a context snapshot.
6. An approval decision binds proposal ID, payload hash, run, actor, and authority. The host compares the base revision atomically with apply. Any changed payload requires another proposal and another review.

The candidate migration encodes useful primary/foreign/unique keys and immutability checks, but not every domain rule. Runtime validators and transition guards are still required. It has been executed only in Python SQLite, not D1; see `schema/schema-notes.md`.

## Event contract

The production envelope is `ConversationEvent` with `schemaVersion: 1`, conversation ID, safe-integer sequence, timestamp, a discriminated type, and a complete browser-safe entity payload. Supported types are `conversation.upsert`, `message.upsert`, `run.upsert`, `proposal.upsert`, and `tool.receipt`.

This deliberately differs from the prototype's lightweight activity records. The production client must never rely on the mock's `getSnapshot()` global or assume that metadata-only activity records can rebuild all content.

Use full message text checkpoints at bounded intervals. Deduplicate by conversation + sequence and replace entities by stable ID. Do not append checkpoint text as if it were a raw token delta. Keep transient optimistic user messages keyed by the request key and replace/associate them with the server's accepted message ID on acknowledgement—never show both as separate turns.

Snapshots contain a consistent `throughEventSeq`. Page from that exact boundary, detecting gaps. When a page has more events, `nextCursor` is the last returned sequence, not the latest server sequence. If the requested cursor is beyond the valid range or before a retained replay window, return a defined error/resync instruction. Do not silently skip events.

## Context/cache manifest

Retain exactly what is needed to explain or reproduce an accepted generation: policy/version identifiers, model parameters, input message selection, explicit summary coverage, skill version/hash pins, bounded host facts with their source revisions, and tool-schema versions. Content is private application data; avoid broad diagnostic endpoints that dump it by default. A safe context view returns metadata, not secrets or internal reasoning.

Use stable canonical JSON plus SHA-256 for payload and manifest hashes. The prototype uses `JSON.stringify` for request equality only; do not call that production canonical hashing. Apply UTF-8 byte limits server-side, independently of browser character counters. Hashes are integrity identifiers, not authorization tokens.

Keep three metrics separate: application context-cache result, provider-reported prompt-cache result, and persisted conversation availability. Missing provider usage data is `unknown`, not zero. No fabricated latency/cost/token counts should be shown.

## Proposed starting limits (configuration, not platform claims)

Use small bounded defaults and adjust after measurements: 16KiB user-message input, 32KiB skill bodies, 256KiB normalized context, bounded generated output, 50 conversations per list page, 100 messages per history page, and at most 200 events per response with an additional total response-byte cap. A single event that exceeds the cap is rejected before storage rather than causing an unrecoverable polling loop.

Start with one active run per conversation and a low per-actor concurrent-run quota. Put maximum model steps, write-tool count, provider deadlines, review expiration, retry ceilings, and outbox age thresholds in explicit server configuration. The exact policy for a live deployment must be written in its operations document and covered by tests; it is not chosen by model output.

## Later adapters

An MCP adapter should translate authenticated tool requests into this same command API. It must preserve scope, request keys, exact proposal decisions, and receipts. It must not mount a second raw model/agent router that bypasses authorization. A CLI can be another client when there is a real use case; neither is needed to finish issue #1's first recipe.
