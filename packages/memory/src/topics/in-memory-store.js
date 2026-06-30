function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

export function createInMemoryTopicStore({ initialTopics = [] } = {}) {
  const byId = new Map();
  const bySession = new Map();
  for (const t of initialTopics) {
    byId.set(t.id, t);
    if (!bySession.has(t.session_id)) bySession.set(t.session_id, []);
    bySession.get(t.session_id).push(t);
  }
  function index(t) {
    if (!bySession.has(t.session_id)) bySession.set(t.session_id, []);
    bySession.get(t.session_id).push(t);
  }
  function deindex(t) {
    if (!bySession.has(t.session_id)) return;
    bySession.set(t.session_id, bySession.get(t.session_id).filter((x) => x.id !== t.id));
  }
  return {
    async create(row) {
      if (byId.has(row.id)) {
        const err = new Error("Topic id already exists.");
        err.code = "topic_conflict";
        throw err;
      }
      byId.set(row.id, { ...row });
      index(row);
      return clone(row);
    },
    async get(id) { return clone(byId.get(id)); },
    async listBySession(session_id, { status, limit = 50, offset = 0 } = {}) {
      const all = (bySession.get(session_id) || [])
        .filter((t) => !status || t.status === status)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return { items: all.slice(offset, offset + limit).map(clone), pagination: { limit, offset, total: all.length } };
    },
    async update(id, patch) {
      const cur = byId.get(id);
      if (!cur) return undefined;
      deindex(cur);
      const next = { ...cur, ...patch };
      byId.set(id, next);
      index(next);
      return clone(next);
    },
    async delete(id) {
      const cur = byId.get(id);
      if (!cur) return false;
      deindex(cur);
      byId.delete(id);
      return true;
    }
  };
}
