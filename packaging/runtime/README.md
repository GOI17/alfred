# Selected runtime build inputs

`allowlist.json` selects runtime sources and workspace modules. The sibling
`package.json` and `package-lock.json` pin production dependencies; the builder
requires the staging lock to match these reviewed bytes before vendoring.
No package-manager installation is needed in the source checkout.

Follow [the Homebrew build guide](../homebrew/README.md) for isolated dependency
staging, deterministic builds, real runtime verification and publication gates.
The builder normalizes archive metadata and rejects traversal, symlinks,
secret-like files and unexpected dependency closure. `SHA256SUMS` binds the
archive, inventory and generated formula; the inventory binds source revision
and build inputs. Repeated identical inputs produce identical bytes.

Local exploratory candidates are not publishable releases. Current v0.7.2
predates this implementation; do not upload new code under that historical tag.
A future committed release snapshot must pass verification before the existing
automatic pipeline updates the canonical tap. Public tap activation and live
Homebrew validation remain separate approval steps.
