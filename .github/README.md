# Verification

The workflow runs `pnpm b4push` on main pushes, pull requests and manual dispatch. It installs the pinned dependencies with the checked-in lockfile and runs browser tests against real zfb builds. Evidence is uploaded even on failure. No secrets or deployment steps are required.

`lefthook.yml` is an optional pre-push hook configuration; install Lefthook yourself if desired. The checks run directly through pnpm without a Git hook dependency.
