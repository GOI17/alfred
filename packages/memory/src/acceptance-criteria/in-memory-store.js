function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

export function createInMemoryACStore({ initialACs = [] } = {}) {
  const byId = new Map();
  const byTopic = new Map();
  for (const a of initialACs) {
    byId.set(a.id, a);
    if (!byTopic.has(a.topic_id)) byTopic.set(a.topic_id, []);
    byTopic.get(a.topic_id).push(a);
  }
  function index(a) {
    if (!byTopic.has(a.topic_id)) byTopic.set(a.topic_id, []);
    byTopic.get(a.topic_id).push(a);
  }
  function deindex(a) {
    if (!byTopic.has(a.topic_id)) return;
    byTopic.set(a.topic_id, byTopic.get(a.topic_id).filter((x) => x.id !== a.id));
  }
  return {
    async create(row) {
      if (byId.has(row.id)) { const err = new Error("AC id already exists."); err.code = "ac_conflict"; throw err; }
      byId.set(row.id, { ...row });
      index(row);
      return clone(row);
    },
    async get(id) { return clone(byId.get(id)); },
    async listByTopic(topic_id, { status, limit = 50, offset = 0 } = {}) {
      const all = (byTopic.get(topic_id) || [])
        .filter((a) => !status || a.status === status)
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
