# Verification — integrated implementation

## zfb 4.4.0 upgrade verification

Date: 2026-10-13. Default branch `main`, refreshed base `3154e7e410c097ec722e5c7ddfdada1f502a6d8e`. Linux x64, Node 24.19.0, pnpm 10.12.1, Python Playwright 1.57.0, system Chromium 154.0.8037.57. Both apps move exact published SDK/runtime pins from **4.3.0 to 4.4.0**; the native binary and slugify dependency move in lockstep. TypeScript and Hono remain unchanged.

The current `dev-bump-zudo-deps` resolver from `Takazudo/claude-settings@4d8315a0ead56dac135ee7d576791371333ca101` scanned all three manifests: four stable-channel bumps, no skips, floating tags, errors or graduation warnings. Runtime's exact SDK peer is satisfied. There is no `ZUDO_DEPS_PINS.md` or upstream-vendored scaffold; staging regenerates copies of this repository's own sources, and generated output remains ignored.

### Published impact assessed

Compared actual lockfile versions 4.3.0 with published 4.4.0 tarballs using `npm diff`, including SDK/package exports and runtime JavaScript/declarations. SDK and slugify tarball changes are package-version metadata only. Runtime changes concern rejected History writes and Back/Forward restoration of browser-created fragment entries; the demo does not use ClientRouter. Release notes through 4.3.1, 4.3.2, 4.3.3 and 4.4.0 also cover MDX wind attribute extraction and native YAML parser budget/performance/tag handling. These TSX apps use `wind: false` and no YAML frontmatter, so no application API adaptation was required. Exact-version preflight and current setup documentation were synchronized.

Published `gitHead` metadata is absent. Verified upstream tags instead: `v4.3.0` = `689dfbfcfe4154aaccffe74d14bb5aadfef3ec6a`; `v4.4.0` = `29377d1c0bfd607dea6d654557e46ff7bf536b2e`. Read the release-specific changelog files under `docs/src/content/docs/changelog/{zfb,zfb-runtime}/` at the new tag. No new upstream defect was established.

### Local gates passed on both versions

The frozen 4.3.0 baseline passed 80 Node tests, both real app checks/builds, public/local bundle isolation, 29 direct workbench checks and 16 real-zfb browser groups. The initial full baseline run reached the final browser suite but could not find Playwright's downloaded browser; CDN downloads are forbidden in this environment. Rerunning that suite with the supported `CHROMIUM_PATH=/usr/bin/chromium` setting passed under the shared guard. No assertions or tests were changed.

After updating, the complete gate passed in one run with `heavy-guard: verdict=PASS exit=0 secs=52`:

```sh
CHROMIUM_PATH=/usr/bin/chromium PYTHON=/tmp/agent-convos-venv/bin/python \
  npm --cache /tmp/agent-convos-npm-cache exec --yes --package=pnpm@10.12.1 -- \
  bash /workspace/portable-codex-home-v51/.codex/scripts/heavy-guard.sh -- pnpm b4push
```

- Exact installed SDK/runtime/native binary preflight: 4.4.0 in both apps.
- Strict core/Worker TypeScript and 80 Node unit/contract/HTTP/SQLite tests: passed, zero failed/skipped.
- Both real zfb checks/builds and generated public/local adapter isolation: passed.
- Direct-browser workbench: 29 checks passed. Actual zfb browser: 16 groups passed, zero uncaught exceptions or failed generated assets.
- Hydration input retention, keyed composer/caret/diffs, reviewed effects, skill versions, stale proposals, retry/cancel/reconnect, synthetic IME, mobile dialogs, scroll anchoring and HTTP/SQLite restart persistence: passed.
- Geometry at 360/390/768/1440 and no public API/model/external requests: passed.
- Post-update `pnpm install --frozen-lockfile` and `git diff --check`: passed.

Visual parity: RGB pixel comparison against baseline screenshots reported **zero changed pixels** for `zfb-390.png` (390×900), `zfb-1440.png` (1440×900), `zfb-skills.png`, `zfb-embedded.png` and `zfb-sqlite.png` (each 1440×1000). Desktop/mobile and local SQLite screenshots were also visually inspected: composer stays visible, transcript layout and proposal cards are retained, and no new overflow appears. Evidence is local/ignored under `evidence/`; baseline copies and command logs are in `/tmp/agent-convos-audit/` for this session. CI uploads its own synthetic evidence.

No deployment, package publication or live-provider operation occurred. Actual workerd/D1 and Cloudflare Queues, production auth/providers, other operating systems/browsers and hardware IME remain the existing integration limits below; Node SQLite and injected Worker ports are not claimed as those runtime proofs. Consult the PR's exact-head Verify check for independent CI status.

## zfb 4.3.0 upgrade verification

Date: 2026-10-10. Refreshed main: `a21cc1081f656027d075c1e09c425e65f368f3ae`. Local environment: Linux x64, Node 24.19.0, pnpm 10.12.1 invoked through npm exec. Both apps pin SDK/runtime to exact published **4.3.0**; native preflight reports 4.3.0 and embedded esbuild 0.25.12. No adapter is used, no bundler override was added, and historical design/reference evidence is retained.

Local commands passed:

- `npm --cache /tmp/zfb-npm-cache view @takazudo/zfb@4.3.0 version dependencies optionalDependencies dist.integrity --json`
- `npm --cache /tmp/zfb-npm-cache view @takazudo/zfb-runtime@4.3.0 version dist.integrity --json`
- `npm --cache /tmp/zfb-npm-cache exec --yes --package=pnpm@10.12.1 -- pnpm install --store-dir /workspace/shared/pnpm-store`
- `node scripts/verify-zfb.mjs` (both apps)
- `node scripts/test.mjs` (80 passed, zero failed/skipped)
- `npm --cache /tmp/zfb-npm-cache exec --yes --package=pnpm@10.12.1 -- pnpm --dir apps/showcase check`
- `npm --cache /tmp/zfb-npm-cache exec --yes --package=pnpm@10.12.1 -- pnpm --dir apps/local check`
- `python3 -m py_compile tests/browser/zfb_smoke.py` and `git diff --check`

The managed approval policy rejected runtime-bridge restoration and the read-only personal-context loader for accessing `/root/.codex`. No workaround was attempted. Local heavy builds/browser runs were not run without the required shared guard; the unchanged Verify workflow owns the complete `pnpm b4push` gate on the draft PR. Consult the PR's exact-head CI result for both actual builds, 29 workbench checks and 16 real-zfb browser groups, including the new asset-failure assertion. Pending or failed CI is not a pass.

Tests use checked-in synthetic scenarios and temporary SQLite databases in a fresh checkout. No private conversation data was read or uploaded. The only workflow verifies and uploads synthetic test evidence; it has no publish/deploy job. Upstream #3879 and existing consumer issues/PRs were inspected; no new upstream defect was established or filed. macOS/Windows/native ARM, Firefox/WebKit/Safari, hardware IME, real D1/Queues and live providers remain unverified.

## zfb 3.1.0 upgrade verification

Date: 2026-10-01. Environment: Linux x64, Node 24.13.1, pnpm 10.12.1, Python Playwright 1.57.0 / Chromium 143.0.7499.4. Exact SDK, runtime and native binary: **3.1.0**.

The full `PYTHON=.venv/bin/python pnpm b4push` gate ran inside the machine-wide browser guard and the repository heavy-guard wrapper: `verdict=PASS`, exit 0. All 80 Node tests, both real zfb checks/builds, public/local bundle isolation, 29 native workbench browser checks and 15 actual zfb browser groups passed, with no uncaught browser exceptions. Direct browser evidence includes local HTTP/SQLite restart persistence, mobile geometry and public network isolation.

No application source migration was needed. Real D1/Queues, production authentication/providers, Safari and hardware IME remain outside this evidence as described below. No resources were deployed.

## Historical zfb 3.0.0 integration evidence

Date: 2026-10-01. Environment: macOS arm64, Node 24.13.0, pnpm 10.12.1, TypeScript 5.8.3, Python Playwright 1.57.0 / Chromium 143.0.7499.4. Exact zfb SDK, runtime and native binary: **3.0.0** (embedded esbuild 0.25.12).

### Passed locally

The complete `PYTHON=../venv/bin/python pnpm b4push` gate passed under the machine-wide heavy/browser guards (`verdict=PASS`, exit 0). The Python path points to the session's isolated environment; use your own virtual environment as shown in README.

| Check | Result |
| --- | --- |
| Installed zfb SDK/runtime/native version preflight and resolved pnpm lockfile | PASS |
| Strict core/client/controller/Worker TypeScript | PASS |
| Actual zfb check and static build, public showcase and separate local UI | PASS |
| Node unit/contract/integration tests | **80 passed, 0 failed, 0 skipped** |
| Native diagnostic workbench, direct browser HTTP | **29 checks passed**, no exceptions |
| Actual zfb UI, direct browser HTTP | **15 groups passed**, no exceptions |
| Public source closure and built bundle isolation | PASS; no HTTP/SQL adapter markers in public bundle |
| Public runtime network requests | PASS; no API, model or external requests |

The browser suites now use normal localhost navigation, native fetch, native Web Crypto, and the actual generated zfb hydration scripts. No HTML injection or crypto/HTTP bridges are used by the full gate.

The zfb groups cover pre-hydration typing; stable composer/caret, keyed messages and open diffs; exact review and confirmed CMS draft changes; rename/export; skill save/restore and pinned historical context; search/archive/restore; stale proposals; retry without duplicated turns; IME Enter protection and text safety; reconnect/replay; cancellation; independent thread drafts; paged-history scroll anchoring; jump-to-latest; mobile dialogs and geometry at 360/390/768/1440; public isolation; and the separate local app's HTTP/SQLite request → review → apply → process-restart persistence flow.

Screenshots of standalone/mobile, skills, embedded CMS and SQLite UI were inspected. Expected: composer remains in the viewport, transcript scrolls separately, narrow-screen navigation/details/skill pickers remain accessible, no horizontal page overflow. Observed: these requirements pass geometry checks and screenshot inspection; Details remains visible on mobile. Hardware keyboard/accessibility behavior is a separate limit below.

The 80 Node tests include memory/SQL contract parity, scoped access/idempotency, atomic acceptance/outbox, expired-lease fencing, cancellation, retained retry inputs, immutable skills, stale approvals, ambiguous-effect receipts, protocol validation and actual HTTP/SQLite restart persistence. A new regression covers browser-native fetch being invoked with the correct receiver; the direct-browser suite confirms the fix. Another regression verifies that replay updates sidebar run status along with the selected transcript.

CI runs the same gate on main pushes and pull requests. See the GitHub Actions run for the pushed commit for its independent result; this file records local evidence. Generated logs/reports/screenshots are ignored locally and uploaded by CI, not committed as binary source artifacts.

### Explicit limitations

- **workerd/D1 and actual Cloudflare Queue delivery are not exercised.** Node SQLite tests validate SQL behavior through an adapter. The Worker handler factory is tested with injected ports and remains disabled by default.
- Production authentication, real host authorization, a live provider, cost policy, retention/erasure and workspace quotas are not implemented. No resources were deployed and no model calls were made.
- Current conversation enumeration loads scoped records before pagination; context selection is bounded recent history, not semantic summarization. Caching is disabled.
- UI drafts and unresolved skill-write descriptors are in memory. Durable accepted state persists; reload recovery of unsent UI state requires host-approved storage integration.
- Safari, Android/Samsung hardware and real Japanese IME were not run. Synthetic composition events do not establish device behavior.

`reference/checkpoint-test-results.md` preserves the original archive's historical evidence. It is superseded by this report for the integrated code.
