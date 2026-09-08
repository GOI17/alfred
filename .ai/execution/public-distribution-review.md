---
id: execution/public-distribution-review
description: Exact reviewed Alfred runtime and pending public activation operations.
owner: orchestrator
phase: issue-204-homebrew-tap-access
status: prepared-awaiting-public-authorization
---

# Public distribution review

Preparation and private CI validation are complete. This record is not authorization to publish.
GOI17/alfred remains private, including its Git history.

## Exact retained candidate

| Item | Reviewed value |
| --- | --- |
| Runtime version | 0.7.2 |
| Source revision | 303ad82c4ba9fdc4641feb0f30e2aef3cd3313c7 |
| Builder revision | 303ad82c4ba9fdc4641feb0f30e2aef3cd3313c7 |
| Archive | alfred-0.7.2-runtime.tar.gz |
| Compressed size | 1,999,956 bytes |
| Contents | 1,894 payload files plus embedded runtime-manifest.json = 1,895 |
| Archive SHA256 | 49bcb601b25190afc7a9b56dd2a78e3ceabf6004fdf7b718b6072681b8f2aed7 |
| Exact formula SHA256 | 01c540507a64e1af8d019a9d8762897ffd6e27dbf1450714f3a825bcb705b3f9 |
| Dependency lock SHA256 | 55e61ffc227bcecebcc28a3b8361c45a37e1795cad571992135ae7898a3429dd |
| Local retained directory | .alfred/distribution/0.7.2-303ad82/ |

The full per-file path/size/mode/SHA256 inventory is committed in
[alfred-0.7.2-runtime-manifest.json](artifacts/alfred-0.7.2-runtime-manifest.json).
The same manifest is embedded in the archive; it inventories every payload file
except itself. The archive checksum covers the embedded manifest. Separate
archive and formula checksum files accompany the retained candidate. QA evidence
is retained beside it as qa-verification.json, outside the release payload.

This is a new distribution built from the commit above, containing packaging and
fresh-machine fixes. It is not described as the old private v0.7.2 source tag's
bytes (that tag points to 28f64f4c1afe97390ae29639c15d170087e1a92e).

## What becomes readable

The package contains 119 first-party application files (including materialized
workspace modules), 29 runtime instruction/metadata files, and 1,746 files from
109 locked production dependencies. These are readable JavaScript/MJS/CJS,
shell, HTML, SQL, JSON/YAML, Markdown instructions and license notices. It uses
Node supplied by Homebrew; calling it a runtime does not hide its code or make
it an opaque native binary. Packaging assigns no new open-source license to
first-party code.

Included application areas are core, profile management, Codex/opencode/Pi
adapters, memory/server/client/MCP, the console, OpenAPI and Anthropic/Gemini
bridges. Instructions include agent/skill/policy metadata, the compatibility
matrix and a generated minimal kernel manifest/install guide. Third-party
notices are retained (107 license files plus the full MIT notices in the
pg-types and pgpass READMEs).

Excluded: Git history, GitHub workflows, tests/spec fixtures, internal execution
and release records, operational traces, local profiles/configuration and
credentials. Optional native OpenTUI executables and Transformers model weights
are omitted; guided setup uses local Node TUI and search uses the keyword path.
Historical internal eval runners are outside the installed CLI/setup contract.
The exact transformations are listed in the manifest. Protected source files
were only read/copied under the user's explicit preparation authorization;
packages/core/ and .ai/harnesses/ were not modified.

## Proposed public destination and exposure

Only the existing GOI17/homebrew-alfred repository would become public. No new
repository is required. Its runtime release would contain exactly three assets:

- alfred-0.7.2-runtime.tar.gz
- runtime-manifest.json
- alfred-0.7.2-runtime.tar.gz.sha256

The formula's exact download URL is:
https://github.com/GOI17/homebrew-alfred/releases/download/v0.7.2/alfred-0.7.2-runtime.tar.gz

The formula is staged in private tap PR #2 at commit
069913fb16a923cfcab1564ec481b561d561bbec with the actual checksum, the updated
README and CI that checks syntax/URL/hash without downloads. It is not activated.
The intended public command is `brew install GOI17/alfred/alfred`; third parties
need no GitHub account, token or private source access.

Visibility would expose the tap's existing history, all branches, issues/PRs
and contributor metadata. The all-branch audit before the final formula commit
covered 10 commits and 16 distinct file blobs across the six paths below. The
final reviewed tap commit adds three new blobs (formula, README and tests), so
the reviewed public history totals 11 commits and 19 distinct blobs.

- Formula/alfred.rb
- README.md
- .github/dependabot.yml
- .github/workflows/autobump.yml
- .github/workflows/publish.yml
- .github/workflows/tests.yml

Branches are main, this task's issue-204-homebrew-tap-access branch and a
Dependabot branch. PRs #1/#2 and their metadata would be visible. There were no
tap tags/releases during the audit. No real credential patterns were found in
the audited file blobs. The source repository is separate and stays private.

## Checks and remaining live verification

- Two independent builds from the clean fixed commit produced identical archive
  and formula bytes.
- Final QA enforced both exact checksums and exploratory:false before testing:
  anonymous local HTTP retrieval; relocated CLI wrapper in paths with spaces;
  advanced/guided setup previews; fresh-HOME SQLite; dependency loading;
  Codex/opencode/Pi previews; live HTTP health/console/OpenAPI; and full MCP stdio
  create/list/update/search/delete through HTTP and SQLite.
- The runtime test guard observed zero external-network attempts and zero
  provider calls. No live harness configuration was applied.
- 34 distribution/generator/workflow tests and 136 SQLite/router/OAuth tests pass.
  Documentation/release validators, JS/YAML/shell syntax and whitespace pass.
  Actual formula Ruby syntax and Homebrew version parsing return 0.7.2.
- Final independent reviewer found no outstanding findings: source/dependency
  bytes, inventory, license notices and the four provenance hashes match their
  reviewed inputs and commit.
- Linux Node24 private CI: the complete-runtime job passed, including locked
  dependency installation, build, smoke and private artifact upload:
  https://github.com/GOI17/alfred/actions/runs/34180923580/job/101919705646 .
  This is CI reconstruction from the PR merge tree, distinct from approval of
  the retained local archive. macOS arm64 Node26.8.1 final smoke passed on the
  exact archive SHA256 above. The CI formula/contracts/style job, Postgres and
  site workflows also passed for source head 303ad82.

The tap and asset are still inaccessible anonymously on GitHub because public
activation is not authorized. A real clean Homebrew installation can be verified
only after the public tap/assets exist and the installation is authorized.
Local HTTP tests do not substitute for that live check.

## Exact operations requiring public approval

No operation in this section has been performed or authorized by preparation.
The public approval must cover the destination/history above and the exact
retained archive/formula hashes, plus the listed activation/install operations.

1. Make only GOI17/homebrew-alfred public, acknowledging its reviewed history,
   branches and PR metadata. Keep GOI17/alfred private.
2. Invoke the existing local scripts/publish-homebrew-runtime.mjs with the
   retained archive, manifest and formula paths under
   .alfred/distribution/0.7.2-303ad82/, destination GOI17/homebrew-alfred and BOTH
   approved SHA256 values above. Supply the existing authorized gh credential
   only in process memory; never print or persist it. No new App is needed for
   this initial local activation.
3. The publisher performs only its fixed API operations: verify private source,
   public destination, source/package/builder/allowlist/lock provenance, current
   formula and release conflicts; create the tap v0.7.2 draft release if absent;
   upload the three exact assets; make the release visible; download the archive
   anonymously and verify its SHA256; then write the approved formula to main.
   It rejects exploratory archives, differing existing bytes, extra assets and
   downgrades. It does not change visibility or publish a source-repo release.
4. Merge the reviewed tap PR #2 after asset verification/formula activation,
   bringing in the matching formula and reviewed documentation/tests. This
   avoids activating its formula before the asset is verified.
5. Run the tap's explicitly authorized public-install verification (Homebrew
   tap/install, including its Git download, version/setup preview and brew test)
   without GitHub credentials. Recheck the private source remains inaccessible
   anonymously. Update installation status documentation after the live check;
   then merge source PR #206 as authorized. No source Release Please release PR
   is included in this approval.

The first activation uses the retained local bytes. A future Actions candidate
has its own preparation run and may have different provenance/hash after merge;
it requires another review. Automated publication retains the prepared scoped
GitHub App and independent approval-variable design, configured only under
separate authorization. That future setup is not a prerequisite for this
initial local activation.

## Review links

- https://github.com/GOI17/alfred/pull/206
- https://github.com/GOI17/homebrew-alfred/pull/2
- https://github.com/GOI17/alfred/issues/204
