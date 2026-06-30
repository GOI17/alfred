// In-memory store for sessions. Tests use this directly; production stores
// can plug into SQLite or Postgres with the same shape.
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

export function createInMemorySessionStore({ initialSessions = [] } = {}) {
  const byId = new Map();
  for (const s of initialSessions) byId.set(s.id, s);
  return {
    async create(row) {
      if (byId.has(row.id)) {
        const err = new Error("Session id already exists.");
        err.code = "session_conflict";
        throw err;
      }
      byId.set(row.id, { ...row });
      return clone(row);
    },
    async get(id) {
      return clone(byId.get(id));
    },
    async listByTenant(tenant_id, { status, limit = 50, offset = 0 } = {}) {
      const all = [...byId.values()]
        .filter((s) => s.tenant_id === tenant_id)
        .filter((s) => !status || s.status === status)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return { items: all.slice(offset, offset + limit).map(clone), pagination: { limit, offset, total: all.length } };
    },
    async update(id, patch) {
      if (!byId.has(id)) return undefined;
      const next = { ...byId.get(id), ...patch };
      byId.set(id, next);
      return clone(next);
    },
    async delete(id) {
      return byId.delete(id);
    }
  };
}
