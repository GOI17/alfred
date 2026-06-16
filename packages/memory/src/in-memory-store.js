function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function applyFilters(memory, options) {
  if (options.type && memory.type !== options.type) return false;
  if (options.namespace && memory.namespace !== options.namespace) return false;
  if (options.projectId && memory.projectId !== options.projectId) return false;
  if (options.tag && !memory.tags.includes(options.tag)) return false;
  return true;
}

function memorySearchText(memory) {
  return [
    memory.type,
    memory.content,
    memory.source,
    memory.namespace,
    memory.projectId,
    ...(memory.tags ?? []),
    JSON.stringify(memory.metadata ?? {})
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesQuery(memory, q) {
  const haystack = memorySearchText(memory);
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function paginate(items, { limit, offset }) {
  return {
    items: items.slice(offset, offset + limit).map(clone),
    pagination: {
      limit,
      offset,
      total: items.length
    }
  };
}

function newestFirst(left, right) {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

const editableMemoryFields = Object.freeze([
  "projectId",
  "type",
  "content",
  "tags",
  "source",
  "metadata",
  "confidence",
  "expiresAt",
  "updatedAt"
]);

function applyEditablePatch(memory, patch) {
  const patchClone = clone(patch) ?? {};
  const updated = { ...memory };
  for (const field of editableMemoryFields) {
    if (Object.prototype.hasOwnProperty.call(patchClone, field)) {
      updated[field] = patchClone[field];
    }
  }
  return updated;
}

export function createInMemoryStore(initialMemories = []) {
  const memories = new Map(initialMemories.map((memory) => [memory.id, clone(memory)]));

  return {
    async create(memory) {
      memories.set(memory.id, clone(memory));
      return clone(memory);
    },

    async list(userId, options) {
      const items = [...memories.values()]
        .filter((memory) => memory.userId === userId)
        .filter((memory) => applyFilters(memory, options))
        .sort(newestFirst);
      return paginate(items, options);
    },

    async search(userId, options) {
      const items = [...memories.values()]
        .filter((memory) => memory.userId === userId)
        .filter((memory) => applyFilters(memory, options))
        .filter((memory) => matchesQuery(memory, options.q))
        .sort(newestFirst);
      return paginate(items, options);
    },

    async get(userId, id) {
      const memory = memories.get(id);
      if (!memory || memory.userId !== userId) return undefined;
      return clone(memory);
    },

    async update(userId, id, patch) {
      const memory = memories.get(id);
      if (!memory || memory.userId !== userId) return undefined;
      const updated = applyEditablePatch(memory, patch);
      memories.set(id, updated);
      return clone(updated);
    },

    async delete(userId, id) {
      const memory = memories.get(id);
      if (!memory || memory.userId !== userId) return false;
      return memories.delete(id);
    }
  };
}
