---
id: memory-hosting-modes
description: >
  Formal definition of the four ways Alfred Memory can be hosted.
  Each mode is a distinct deployment shape with different tradeoffs.
owner: core
status: active
applies_to: packages/memory/** and packages/memory-server/**
---

# Memory Hosting Modes

Alfred Memory is the persistent store Alfred agents use to remember durable knowledge
across sessions and harnesses. It can be hosted in **four distinct modes**, each
with its own operational, security, and complexity profile.

Choosing a mode is a **product decision**, not a technical one. The implementation
supports all four. The choice belongs to the operator based on data sensitivity,
hosting constraints, and the agents involved.

## Mode 1 — `local-only`

**Shape**: A single-process Alfred Memory server bound to `127.0.0.1`. No HTTPS.
No external auth beyond loopback trust. SQLite per tenant.

**When to use**:
- Solo dev on a single laptop.
- Throwaway experiments where data loss is acceptable.
- CI smoke tests for adapters.

**Tradeoffs**:
- Zero configuration. Runs from `alfred init`.
- Easiest to audit (one file per tenant).
- Not shareable across machines or agents running outside the loopback interface.
- Human agents (ChatGPT, Claude web, Gemini) cannot reach it.

**Configuration**:
```
ALFRED_MEMORY_HOSTING=local
ALFRED_MEMORY_PORT=3000
ALFRED_MEMORY_BIND=127.0.0.1
```

## Mode 2 — `self-hosted` (chosen for v0.3.0 MVP)

**Shape**: Alfred Memory Server runs on infrastructure the operator controls (VPS,
Render, Fly.io, on-prem). Multi-tenant with one Postgres DB per tenant. API keys
issue per agent. HTTPS required in production.

**When to use**:
- Multiple agents (opencode, Codex, ChatGPT Custom GPT, Claude web) sharing memory.
- B2B consulting with per-client isolation that must be auditable.
- Production deployments where the operator wants full control.

**Tradeoffs**:
- Shared memory across many agents and harnesses.
- One URL to monitor, backup, and audit.
- The same `tenant_id` isolation guarantees are preserved.
- Operator owns uptime, backups, HTTPS certs, monitoring.
- More moving parts than `local-only`.

**Configuration**:
```
ALFRED_MEMORY_HOSTING=self-hosted
ALFRED_MEMORY_PORT=443
ALFRED_MEMORY_BIND=0.0.0.0
ALFRED_MEMORY_TLS_CERT=/etc/letsencrypt/...
ALFRED_MEMORY_TLS_KEY=/etc/letsencrypt/...
ALFRED_MEMORY_ALLOWED_ORIGINS=https://chat.openai.com,https://claude.ai
```

## Mode 3 — federated (deferred to v0.4.0)

**Shape**: Each agent keeps its own local Alfred Memory instance. Sync between
instances happens via a CRDT or last-write-wins protocol with optional conflict
resolution UI.

**When to use**:
- Strict local-first preference with no central server.
- Edge deployments where bandwidth is scarce.
- Auditable separation between agents (each agent sees only its own DB).

**Tradeoffs**:
- Fully local-first. No central server to operate.
- Each agent keeps a complete, inspectable local DB.
- "Shared memory" becomes asynchronous. Lag between writes.
- Conflict resolution is a UX problem.

## Mode 4 — hybrid (deferred to v0.4.0)

**Shape**: Each agent reads/writes against a `self-hosted` server, but keeps a
small local cache for offline or low-latency reads.

**When to use**:
- Mostly connected, occasionally offline.
- Read-heavy workloads that benefit from caching.
- Agents that must keep working when the cloud is unreachable.

**Tradeoffs**:
- Fast reads when cached.
- Source-of-truth remains single and auditable.
- Cache invalidation is hard.
- Writes still go to the cloud — offline writes need a queue.

## Decision Matrix

| Need | Mode |
|---|---|
| Solo dev, single machine | Mode 1 (local-only) |
| Multi-agent, multi-machine, auditable | Mode 2 (self-hosted) <- v0.3.0 MVP |
| Air-gapped or strict local-only with sync | Mode 3 (federated) |
| Mostly online, occasional offline | Mode 4 (hybrid) |

## Relationship to Memory Storage Backend

| Mode | Default backend |
|---|---|
| Mode 1 | SQLite per tenant |
| Mode 2 | Postgres per tenant (mandatory for human agents) |
| Mode 3 | SQLite or Postgres per agent |
| Mode 4 | Postgres in cloud, SQLite as local cache |

See `.ai/policies/memory-hosting-policy.md` for the storage backend selection
rules that apply across modes.

## Related Policies

- `.ai/policies/memory-hosting-policy.md` - storage backend by tenant kind
- `.ai/policies/memory-workspace-policy.md` - workspace hierarchy and access
- `.ai/policies/security.md` - deny-by-default, human approval gates
