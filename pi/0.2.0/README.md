# Alfred Pi Agent v0.2.0

Alfred handles the operational burden so humans focus on decisions.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh
```

Or with a custom path:

```bash
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --path ./my-workspace
```

## Structure

```
.
├── AGENTS.md                    # Orchestrator agent instructions
└── .alfred/
    ├── config.json               # Harness configuration
    ├── agents/                   # Agent specifications
    │   ├── orchestrator.md
    │   ├── developer.md
    │   ├── qa.md
    │   ├── librarian.md
    │   ├── architect.md
    │   └── reviewer.md
    ├── skills/                   # Skill manifests
    │   └── registry.json
    └── pi-adapter/               # Pi adapter runtime
        ├── runtime.js
        ├── cli.js
        ├── package.json
        └── README.md
```

## Capabilities

- **Primary Control**: Agent orchestration
- **Specialist Routing**: Task delegation to specialists
- **Lazy Skills**: On-demand skill loading
- **Permission Enforcement**: Deny-by-default security
- **Trace Emission**: Full operation observability
- **Eval Execution**: Reproducible testing
- **Model Assignment**: User-owned model configuration
- **Local-First**: Minimize provider calls

## Updating

```bash
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh
```

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh
```

## Documentation

- Full agent instructions: `AGENTS.md`
- Project source: https://github.com/GOI17/alfred