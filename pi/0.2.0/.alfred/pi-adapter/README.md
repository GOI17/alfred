# Alfred Pi Adapter

Alfred agent operations system adapter for Pi.dev harness.

## Version

0.2.0

## Purpose

This adapter provides Alfred's agent operations capabilities for Pi:
- Orchestration of multi-agent workflows
- Specialist routing and delegation
- Lazy-loaded skills
- Permission enforcement
- Trace emission
- Eval execution
- Model assignment

## Files

- `runtime.js` - Core adapter runtime
- `cli.js` - CLI entry point for running spikes
- `package.json` - Package configuration

## Usage

```bash
# Run the default runtime spike (phase-2)
node runtime.js

# Run specific phase spikes
node cli.js phase-2   # Provider request avoided
node cli.js phase-3   # Delegation decisions
node cli.js phase-4   # Permission enforcement
node cli.js phase-5   # Eval gate
node cli.js phase-6   # Skill loading
```

## Documentation

See AGENTS.md for full agent instructions.