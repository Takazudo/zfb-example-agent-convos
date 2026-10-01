# Verification results — development checkpoint

**Date:** 2026-09-30
**Target:** `Takazudo/zfb-example-agent-convos`, issue #1
**Evidence status:** executable implementation tested in this container; no production/deployment certification.

## Completed here

| Gate | Result | Evidence |
| --- | --- | --- |
| Strict core/client/controller/Worker TypeScript | PASS, TypeScript 5.8.3, including unused-local/parameter checks | `tsconfig.core.json`, `evidence/final-offline-log.txt` |
| Separate mock and HTTP workbench compilation | PASS, actual TypeScript AMD output, no substitute framework runtime | `scripts/build-workbench.mjs`, `artifacts/` |
| Node unit/contract/integration suite | **78 passed, 0 failed, 0 skipped** | `evidence/final-offline-log.txt` |
| Chromium native-workbench regression checks | **29 passed, 0 uncaught browser exceptions** | `evidence/browser-results.json`, `evidence/browser-log.txt` |
| zfb source syntax and public import closure | PASS for **19 source files**; not an SDK type check | `evidence/showcase-source-check.json` |
| Actual local HTTP + SQLite background work and process restart | PASS, included in the 78 Node tests | `tests/contract/server.test.mjs` |
| Persisted host-effect receipt across SQLite close/reopen | PASS, included in the 78 Node tests | `tests/contract/worker.test.mjs` |

The final command was `node scripts/test.mjs`, followed by `python3 tests/browser/smoke.py`. The generated source, workbench and evidence are from that checkpoint. Earlier raw logs in `evidence/` are intermediate runs, not additional tests to add to these totals.

## What those tests exercise

The memory and SQL repositories run the same conversation contract, including scoped access, rejected forged identities, event/message paging, optimistic revisions, scoped idempotency, one active run, accepted intent surviving before dispatch, duplicate queue delivery, send/mark loss, expired claims, fenced late writes, partial output, cancellation, retry with retained context, immutable skill history, restore-as-new-version, proposal hashes, stale host bases, current host permissions, ambiguous effects, reconciliation and reversible archive.

The HTTP tests exercise bounded readers, exact envelopes/entities, no-store behavior, origin/body/query/key guards, sanitized internal errors, explicit transport failures, and absence of implicit mutation retries. Controller tests include late snapshots, per-thread and pre-activation drafts, selection, lost-send/approval response recovery, no duplicate user turn, malformed local descriptors, storage denial, local disposal without run cancellation, IME Enter guards and same-timestamp run ordering.

The actual loopback-server tests use real Node HTTP requests and the SQL repository through Node's built-in SQLite API. One test stops and restarts the server process, then verifies the retained conversation and host draft/receipt. Host, Origin, cross-site request and unknown-path behavior is tested with actual HTTP request headers.

The browser checks exercise the native workbench, including exact diff disclosure, stable composer/selection during updates, reviewed draft application, CMS preview, skill edit and restore, retained original skill pins, export, stale refresh, retry, composition guarding, untrusted markup as text, reconnect, older history and mobile dialogs. Layout checks use widths 360, 390, 768 and 1440 pixels. They are viewport tests, not real-device evidence.

## Restricted browser harness — important

This container's Chromium reports `ERR_BLOCKED_BY_ADMINISTRATOR` for file, localhost and ordinary HTTPS navigation. The tests therefore load the generated HTML with Playwright `set_content`.

That blank-page context does not expose native `SubtleCrypto`. Only in the test harness, SHA-256 is bridged to Python's real `hashlib.sha256`; the browser RNG remains native. The delivered HTML contains no such bridge and expects the normal browser Web Crypto API. Core hashing and serialization are also exercised with Node's native Web Crypto in the Node tests.

For the SQL-backed browser checks, a harness fetch bridge forwards requests to the **actual local Node HTTP server** and returns its real responses. The backend, SQL repository and database are not faked. This does **not** verify native browser networking, cookies, CORS, CSP enforcement or normal navigation. The independent Node HTTP tests do not have that transport bridge.

The test script supports `CONVOS_BROWSER_DIRECT=1` on an unrestricted local machine. That mode uses ordinary localhost navigation, native browser fetch and native Web Crypto, and still targets the actual local server. It has not been run here.

## Explicitly blocked or not run

| Gate | Status |
| --- | --- |
| npm registry access | FAILED: `npm view @takazudo/zfb@3.0.0 version` returned `EAI_AGAIN registry.npmjs.org`; see `evidence/npm-registry-probe.txt` |
| Real dependency installation / resolved pnpm lockfile | NOT RUN successfully; no invented lockfile supplied |
| zfb 3.0.0 installed package/binary preflight | BLOCKED, deliberately nonzero; `evidence/zfb-preflight.txt` |
| zfb SDK type check, actual build and actual hydration | **NOT RUN**; source parsing is not equivalent evidence |
| `tests/browser/zfb_smoke.py` | Authored for the actual built app, NOT RUN |
| Full `pnpm b4push` / GitHub CI | NOT PASSED / NOT RUN; real installation, reviewed lockfile and direct-browser gates are mandatory |
| Actual workerd/Miniflare/D1 binding and Cloudflare Queues | **NOT RUN**; SQLite is not being called D1 |
| Safari, Android hardware, Samsung Japanese IME / external keyboard | NOT RUN; synthetic events are not hardware evidence |
| Real model/provider integration | NOT RUN and not enabled |
| Deployment, resource provisioning, package publish, Git push, issue changes | NOT DONE |

## Runtime and source facts

Tested Node: **22.16.0**, built-in SQLite **3.49.1** (Node marks the SQLite API experimental), TypeScript **5.8.3**, Python Playwright **1.57.0**, Chromium at `/usr/bin/chromium`.

The selected zfb package/binary baseline is **3.0.0**, following the supplied updated plan and inspected upstream tag `8219310917c4e697a5c9eb292bd68b4ae7a7cefc`. Selection and source inspection do not establish a successful registry install. `scripts/verify-zfb.mjs` refuses a missing or mismatched installation.

The work remains a development checkpoint. Read `CONTINUE-HERE.md` for the remaining runtime proofs, UI parity, authentication integration and operational policy work.
