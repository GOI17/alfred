# Alfred Profile Manager

`@alfred-labs/profile-manager` integrates the `GOI17/agents` / `agent-switcher`
idea into Alfred as a first-party component: reusable runtime profiles for the
same agent across machines, harnesses, provider availability, model availability,
PATH differences, and plugins.

The package keeps Alfred's boundaries:

- profile/domain planning is local-first and provider-free;
- tracked profile defaults live in `profiles/`;
- machine-private overlays live in ignored `profiles.local/`;
- activation is preview/dry-run first and refuses unsafe overwrites by default;
- harness-specific rendering remains in adapter packages.

## Layout

```text
profiles/
  work/
    opencode/
      opencode.jsonc
profiles.local/
  work/
    opencode/
      opencode.jsonc
```

## CLI

```bash
alfred-profile init --repo ~/.alfred/profiles
alfred-profile doctor --repo ~/.alfred/profiles --agent opencode --profile work
alfred-profile plan --repo ~/.alfred/profiles --agent opencode --profile work
alfred-profile switch --repo ~/.alfred/profiles --agent opencode --profile work --home "$HOME"
```

`switch` symlinks `~/.config/<agent>` to the materialized local profile after
scanning tracked profile JSON/JSONC for likely secrets. It does not write provider
or model defaults; those remain user/machine-owned runtime configuration.
