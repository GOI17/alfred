import { createHash } from "node:crypto";

// Evidence is local to this server process, not a durable agent/session registry.
export function createAgentActivity({
  now = Date.now, recentMs = 60_000, requestTimeoutMs = 300_000,
  retentionMs = 86_400_000, maxEntries = 1000, maxActiveRequests = 100, trace = null
} = {}) {
  for (const value of [recentMs, requestTimeoutMs, retentionMs, maxEntries, maxActiveRequests]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Activity limits must be positive integers.");
  }
  const entries = new Map();
  function sweep(time) {
    for (const [key, row] of entries) {
      for (const [request, started] of row.pending) {
        if (time - started >= requestTimeoutMs) {
          row.pending.delete(request);
          row.last_outcome = "expired";
        }
      }
      if (!row.pending.size && time - row.lastSeen >= retentionMs) entries.delete(key);
    }
  }
  function emit(tenantId, outcome) {
    if (typeof trace !== "function") return;
    try {
      Promise.resolve(trace({ tenant_id: tenantId, event: "agent.activity", payload: { outcome, provider_calls: 0 } })).catch(() => {});
    } catch { /* Observation must not break memory operations. */ }
  }
  return {
    start({ tenantId, credentialId, credentialKind, transport }) {
      if (![tenantId, credentialId, credentialKind, transport].every((v) => typeof v === "string" && v.length > 0)) return () => {};
      const time = now();
      sweep(time);
      const key = JSON.stringify([tenantId, credentialKind, credentialId, transport]);
      let row = entries.get(key);
      if (!row) {
        if (entries.size >= maxEntries) {
          const oldest = [...entries].filter(([, value]) => !value.pending.size)
            .sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
          if (!oldest) return () => {};
          entries.delete(oldest[0]);
        }
        row = { id: createHash("sha256").update(key).digest("hex").slice(0, 24), tenantId,
          credential_id: credentialId, credential_kind: credentialKind, transport,
          first_seen_at: new Date(time).toISOString(), lastSeen: time, last_outcome: null, pending: new Map() };
        entries.set(key, row);
      }
      if (row.pending.size >= maxActiveRequests) return () => {};
      const request = Symbol();
      row.pending.set(request, time);
      row.lastSeen = time;
      emit(tenantId, "started");
      return (outcome = "completed") => {
        // A late completion cannot revive a timed-out or evicted observation.
        const started = row.pending.get(request);
        if (!row.pending.delete(request)) return;
        if (now() - started >= requestTimeoutMs) { row.last_outcome = "expired"; return; }
        row.lastSeen = now();
        row.last_outcome = ["completed", "failed", "aborted"].includes(outcome) ? outcome : "failed";
        emit(tenantId, row.last_outcome);
      };
    },
    list(tenantId) {
      const time = now();
      sweep(time);
      const items = [...entries.values()].filter((row) => row.tenantId === tenantId).map((row) => ({
        id: row.id, credential_id: row.credential_id, credential_kind: row.credential_kind,
        transport: row.transport, workspace_id: null,
        first_seen_at: row.first_seen_at, last_seen_at: new Date(row.lastSeen).toISOString(),
        active_requests: row.pending.size, last_outcome: row.last_outcome,
        status: row.pending.size ? "connected" : row.last_outcome === "aborted" ? "disconnected"
          : row.last_outcome === "expired" || time - row.lastSeen >= recentMs ? "inactive" : "recently_active"
      })).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at) || a.id.localeCompare(b.id));
      return { items, observed_at: new Date(time).toISOString(), recent_window_ms: recentMs,
        request_timeout_ms: requestTimeoutMs, retention_ms: retentionMs, max_entries: maxEntries, max_active_requests: maxActiveRequests, scope: "server_process" };
    }
  };
}

export function observeAgentRequest(activity, identity, req, res) {
  if (!activity || req.aborted || res.destroyed) return () => {};
  const finish = activity.start(identity);
  let ended = false;
  const end = (outcome) => {
    if (ended) return;
    ended = true;
    res.removeListener?.("finish", onFinish);
    res.removeListener?.("close", onClose);
    res.removeListener?.("error", onAbort);
    req.removeListener?.("aborted", onAbort);
    req.removeListener?.("error", onAbort);
    finish(outcome);
  };
  const onFinish = () => end(res.statusCode >= 400 ? "failed" : "completed");
  const onClose = () => end(res.writableEnded ? (res.statusCode >= 400 ? "failed" : "completed") : "aborted");
  const onAbort = () => end("aborted");
  res.on?.("finish", onFinish);
  res.on?.("close", onClose);
  res.on?.("error", onAbort);
  req.on?.("aborted", onAbort);
  req.on?.("error", onAbort);
  return end;
}

export function agentIdentity(resolved, transport) {
  return { tenantId: resolved.tenant_id,
    credentialId: resolved.key_id ?? resolved.client_id ?? resolved.token_id,
    credentialKind: resolved.key_id ? "api_key" : resolved.client_id ? "oauth_client" : "oauth_token",
    transport };
}
