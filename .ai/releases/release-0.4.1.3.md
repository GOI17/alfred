# Release 0.4.1.3: CI Test Portability Fix

Follow-up to v0.4.1.2 (the deploy-fly / ci-postgres hotfix). v0.4.1.2 fixed
two real bugs but the `memory-server-console-handlers` gate kept failing in
CI on the very next push because the test file was hardcoded to a macOS
checkout path. v0.4.1.3 is the actual fix that makes CI green.

## What was broken

The hotfix in v0.4.1.2 successfully fixed:

- `deploy-fly` install step (`pnpm install --frozen-lockfile` → `node --check` syntax pass).
- `ci-postgres` cross-tenant test (`URL().toString().split('search_path=')` → `schemaNameFor(tenantId)`).
- Workflow Node versions (22 → 24).
- Workflow timeouts (added 10/15 minute caps).

But `memory-server-console-handlers` was failing in CI for a different
reason: the test file `console.test.mjs` had 8 references to the literal
path `/Users/josegilbertoolivasibarra/Documents/personal/workspace/alfred/...`.
That path exists on the developer's machine and on no one else's — in
particular, not on the GitHub Actions Linux runner. The CI error was:

```
expected: true,
operator: '==',
diff: 'simple'
```

…from `assert.ok(existsSync("/Users/.../console-web/dist/index.html"))`.

Local `node --test` reported 97/97 passing because the macOS path *did*
exist locally. CI was the only environment that caught the bug.

## What v0.4.1.3 changes

### 1. Portable project root in `console.test.mjs`

The `makeProjectRoot()` helper now computes the project root from
`import.meta.url`:

```js
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function makeProjectRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}
```

This works on every checkout location and every OS. 8 call sites in
`console.test.mjs` that previously hardcoded the macOS path now call
`join(makeProjectRoot(), ...)` instead.

### 2. Hermetic fake dist for the "GET /console returns 200" test

The test previously called `existsSync()` on the real
`packages/console-web/dist/index.html`, which forced CI to build
`console-web` even for an unrelated router test. v0.4.1.3 replaces this
with a temp-dir fake:

```js
const tmp = mkdtempSync(join(tmpdir(), "alfred-console-"));
const fakeDist = tmp + "/dist";
mkdirSync(fakeDist);
writeFileSync(join(fakeDist, "index.html"), "<!doctype html>...");
```

The router receives the fake dir via `consoleDirOverride`, which was
already supported. No production behavior changes.

### 3. No source or behavior changes

This is a pure test-portability fix. `node --test
packages/memory-server/test/console.test.mjs` goes from "97/97 locally,
fail in CI" to "97/97 in every environment".

## Files

- `packages/memory-server/test/console.test.mjs` (portable paths + hermetic dist)
- `packages/memory/CHANGELOG.md` (0.4.1.3 entry)

## Validation

- `validate:release-0.4.1` → 17/17 gates PASS (244 tests) — verified locally
  with `node scripts/validate-release-0.4.1.mjs`.
- `validate:policies` → 12/12 checks PASS.
- Provider calls: 0.
- After pushing this commit, `deploy-fly.yml` and `ci-postgres.yml` should
  both go green on the next push to `main`.

## Why v0.4.1.3 and not "v0.4.1.2 amended"

The v0.4.1.2 hotfix (`fcb8ea3`) was pushed to `main` and survived long
enough to fail in CI on a real run (run `28557676069`). Amending that
commit and force-pushing would have rewritten history that was already
referenced by a parallel feature branch (`GOI17/alfred-landing`) and
visible in CI. Cleaner to ship v0.4.1.3 as a follow-up commit that
preserves the audit trail of "v0.4.1.2 attempted the fix, v0.4.1.3
completed it".
