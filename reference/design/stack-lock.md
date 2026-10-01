# Stack lock · selected baseline, installation pending

**Updated:** 2026-09-30 (Asia/Tokyo). This file deliberately distinguishes release/source evidence from an installed lockfile. Fill in the installation evidence during local P0; do not report an unperformed check as PASS.

## Selected and source-verified

| Item | Selected value | Evidence/status |
| --- | --- | --- |
| zfb release | `v3.0.0` | Latest stable GitHub release; not a prerelease |
| Release time | `2026-09-29T15:28:59Z` | `2026-09-30 00:28:59 JST` |
| Tag commit | `8219310917c4e697a5c9eb292bd68b4ae7a7cefc` | Tag directly resolves to this commit |
| `@takazudo/zfb` | `3.0.0` exactly | Tagged manifest verified; npm artifact not installed here |
| `@takazudo/zfb-runtime` | `3.0.0` exactly | Tagged manifest verified; npm artifact not installed here |
| zudo-react | Bundled SDK subpaths | Exports verified in tagged source; installed exports still need checking |
| Styling | Authored CSS, `wind: false` | Supported by tagged migration guide |
| JSX import source | `@takazudo/zfb/zudo-react` | Supported by tagged migration guide |
| Cloudflare SSR adapter | Not selected | Separate static shell/gateway architecture; add only for an explicit SSR requirement |

The source package minimums are Node `>=22.0.0` and pnpm `>=10.0.0`. They are minimums, not exact application pins. Retain a compatible existing house toolchain or resolve/pin one during P0. Do not prescribe the handoff container's tools as the deployment toolchain.

## Local installation sequence

Inspect existing repository/package-manager instructions first. After creating the actual showcase package, merge the exact dependencies. For the proposed `apps/showcase` layout:

```sh
pnpm --dir apps/showcase add --save-dev --save-exact @takazudo/zfb@3.0.0
pnpm --dir apps/showcase add --save-exact @takazudo/zfb-runtime@3.0.0

# Run the helper from this handoff directory, targeting the real project path.
node scripts/verify-zfb-v3.mjs /absolute/path/to/repo/apps/showcase

# Run in the repository after creating the shell/config/components.
pnpm --dir apps/showcase exec zfb --version
pnpm --dir apps/showcase exec zfb check
pnpm --dir apps/showcase exec zfb build
```

The helper checks direct version pins, installed SDK/runtime manifests, required export resolution, and the package-local launcher output. It does not install anything, contact a registry, build the app, or verify hydration. Its own tests use fake package fixtures; that is not an installed-zfb test.

If a registry freshness policy blocks the exact new package, inspect the active pnpm policy and apply only the house-approved scoped exception. Do not globally disable supply-chain checks or silently select an older package. If an exact artifact remains unavailable, record the failure and continue independent contract/mock work; do not recreate the old v2/prerelease design branch.

## Evidence to fill in locally

| Evidence | Current status |
| --- | --- |
| npm registry exact-version availability and dist-tags | NOT VERIFIED — web access unavailable; container DNS failed |
| Installed SDK/runtime versions and export paths | NOT RUN |
| Actual local binary version / embedded esbuild line | NOT RUN |
| Exact Node / pnpm / TypeScript pins | TO RECORD FROM LOCAL TOOLCHAIN |
| Exact Wrangler / Hono / test-tool pins | TO RECORD FROM LOCAL TOOLCHAIN |
| Lockfile path, commit, and hash | TO RECORD AFTER INSTALL |
| Package-local helper | NOT RUN AGAINST REAL ZFB |
| `zfb check` / `zfb build` | NOT RUN |
| True v3 island hydration and model tests | NOT RUN |
| Public mock build/import isolation | NOT RUN |
| Local D1 / Queues / service binding | NOT RUN |

Update these cells with command, exit status, timestamp, and a repository-local evidence path. Preserve the release/source identity above. A later upgrade is a deliberate new lock update, not a floating `latest` dependency.
