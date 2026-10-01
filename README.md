# Agent conversations

A zfb 3.1.0 recipe for conversation history, queued agent runs, versioned skills, and reviewed host changes. Both the public showcase and the persistent local app render with **real zudo-react**. The provider and CMS are synthetic: no API key, model call, cloud account, or deployment is needed.

## Run locally

Use Node 22.16+ and pnpm 10.12.1:

```sh
pnpm install --frozen-lockfile
pnpm dev:local
```

Open **http://127.0.0.1:8787/** for the zfb UI backed by real HTTP and SQLite. Conversations, immutable skill revisions, accepted runs, proposals and host-effect receipts survive server restarts in `.dev-state/conversations.sqlite`.

Open **http://127.0.0.1:8787/mock** for the memory-only zfb showcase. Its scenarios reset on reload or scenario change. To develop or publish only this static mock graph:

```sh
pnpm dev
pnpm build
# Static output: apps/showcase/dist/
```

The public graph contains no HTTP client, SQL repository, credentials, or live-provider switch. The local UI is a separate zfb build in `apps/local/dist/`, generated from the same components with an HTTP session adapter. Never publish that local build as the public demo.

The loopback server uses a fixed synthetic identity and accepts only local same-origin traffic. It is a development harness, not a production authentication system. Use synthetic data. Choose a different local port/database with `PORT=8790 CONVOS_DB=.dev-state/other.sqlite node dev/server.mjs` after building.

## Try the flows

- Create, search, rename, archive/restore, and export conversations; drafts belong to their individual threads.
- Review the exact before/after diff before applying a draft. Switch to **In a CMS** to see confirmed host changes.
- Use **Stale proposal** to reject an outdated host revision and prepare a fresh review.
- Disconnect during generation, then reconnect to replay retained events. Stop and retry runs without duplicating accepted user turns.
- Edit or restore skill versions. Previously accepted runs retain their original instruction versions.
- Load older messages without losing the reading position. Mobile navigation and the skill chooser use native dialogs.

The previous native-DOM workbench remains at `/workbench` and `/workbench/mock` as a diagnostic reference; the main app does not embed it. `/reference` shows the archived design prototype.

## Verify

```sh
pnpm typecheck
pnpm test
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium
PYTHON=.venv/bin/python pnpm b4push
```

`b4push` verifies exact installed SDK/runtime/binary versions and the lockfile, compiles the core and both zfb apps, runs the Node tests, then tests both native workbench and actual zfb pages through normal browser HTTP/Web Crypto. It uses the machine-wide heavy-test guard when installed. No production access is involved. CI runs the same gate on main and pull requests.

## Structure and boundaries

- `packages/core`, `client`, and `controller`: framework-neutral contracts, scoped commands, pinned inputs, event replay and per-thread state.
- `workers/conversations`: transactional SQL repository, lease-fenced execution, durable outbox/repair, HTTP boundary and an injected Worker handler factory.
- `packages/mock`: fake provider, memory repository and synthetic host with idempotent effect receipts.
- `apps/showcase/components`: shared zudo-react UI and public session adapter.
- `dev/zfb-session.ts`: local HTTP adapter, staged exclusively into the separate local build.
- `scripts/stage-*.mjs`: explicit source allowlists; generated copies must not be hand-edited.

This is a runnable recipe, **not a production deployment**. Real workerd/D1 and Cloudflare Queue delivery, production identity/host authorization, retention/quotas, live providers and hardware IME checks remain integration work. The local database uses the D1 repository's SQL through Node SQLite; that is not proof of D1 runtime compatibility. See `TEST-RESULTS.md`, `docs/implementation.md`, and `CONTINUE-HERE.md` for evidence and limitations.
