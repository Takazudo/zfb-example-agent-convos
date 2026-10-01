# Agent development

Read `CONTINUE-HERE.md`, `TEST-RESULTS.md`, and `docs/implementation.md` first.

The editable source is TypeScript under packages/, workers/, and apps/. `build/`, `artifacts/`, and `apps/showcase/components/shared/ and apps/local/ (except package.json)` are generated. Do not change generated code to make tests pass. Keep the mock-only public graph separate from HTTP/SQL/private-host adapters.

Use exact zfb 3.0.0 SDK/runtime. Use bundled zudo-react, authored CSS and wind:false; no Preact/React hooks or Tailwind scaffold. Never call the native workbench proof a zfb build. Missing installed dependencies must block the real build gate.

Do not accept authority from browser or queued metadata. Keep atomic acceptance/outbox, scoped idempotency, immutable input/skill pins, lease fencing, stale-base checks and ambiguous-effect reconciliation. The dev identity is synthetic and never a production fallback. No live model/deploy/push without explicit permission.

`node scripts/test.mjs` is the offline code/SQLite/HTTP gate. Browser workbench tests and actual zfb browser tests are separate. `pnpm b4push` is the stricter proposed integration gate; it must fail when real installation, lockfile, build or direct-browser evidence is unavailable. Actual D1/Queues gates still have to be added locally. Run pnpm b4push for the full local gate; its wrapper uses the shared heavy guard when installed.
