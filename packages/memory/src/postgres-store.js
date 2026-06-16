function toMemory(row) {
  if (!row) return undefined;
  return removeUndefined({
    id: row.id,
    userId: row.user_id,
    namespace: row.namespace,
    projectId: row.project_id,
    type: row.type,
    content: row.content,
    tags: row.tags ?? [],
    source: row.source,
    metadata: row.metadata ?? {},
    confidence: row.confidence === null ? undefined : row.confidence,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  });
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function addFilters(parts, values, options) {
  if (options.type) {
    values.push(options.type);
    parts.push(`type = $${values.length}`);
  }
  if (options.namespace) {
    values.push(options.namespace);
    parts.push(`namespace = $${values.length}`);
  }
  if (options.projectId) {
    values.push(options.projectId);
    parts.push(`project_id = $${values.length}`);
  }
  if (options.tag) {
    values.push(options.tag);
    parts.push(`$${values.length} = ANY(tags)`);
  }
}

function paginationFrom(row, options) {
  return {
    limit: options.limit,
    offset: options.offset,
    total: Number(row?.total_count ?? 0)
  };
}

async function countMemories(client, where, values) {
  const result = await client.query(`SELECT COUNT(*) AS total_count FROM alfred_memories WHERE ${where.join(" AND ")}`, values);
  return Number(result.rows[0]?.total_count ?? 0);
}

export function createPostgresMemoryStore(client) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("createPostgresMemoryStore requires a pg-style client or pool with query(text, values).");
  }

  return {
    async create(memory) {
      const result = await client.query(
        `INSERT INTO alfred_memories (
          id, user_id, namespace, project_id, type, content, tags, source, metadata, confidence, expires_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
        RETURNING *`,
        [
          memory.id,
          memory.userId,
          memory.namespace,
          memory.projectId ?? null,
          memory.type,
          memory.content,
          memory.tags,
          memory.source,
          JSON.stringify(memory.metadata ?? {}),
          memory.confidence ?? null,
          memory.expiresAt ?? null,
          memory.createdAt,
          memory.updatedAt
        ]
      );
      return toMemory(result.rows[0]);
    },

    async list(userId, options) {
      const values = [userId];
      const where = ["user_id = $1"];
      addFilters(where, values, options);
      values.push(options.limit, options.offset);
      const result = await client.query(
        `SELECT *, COUNT(*) OVER() AS total_count
         FROM alfred_memories
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC, id DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );
      const pagination =
        result.rows.length > 0
          ? paginationFrom(result.rows[0], options)
          : { limit: options.limit, offset: options.offset, total: await countMemories(client, where, values.slice(0, -2)) };
      return {
        items: result.rows.map(toMemory),
        pagination
      };
    },

    async search(userId, options) {
      const values = [userId];
      const where = ["user_id = $1"];
      addFilters(where, values, options);
      values.push(`%${options.q}%`);
      const likeQueryIndex = values.length;
      where.push(`(
        content ILIKE $${likeQueryIndex}
        OR source ILIKE $${likeQueryIndex}
        OR type ILIKE $${likeQueryIndex}
        OR namespace ILIKE $${likeQueryIndex}
        OR project_id ILIKE $${likeQueryIndex}
        OR array_to_string(tags, ' ') ILIKE $${likeQueryIndex}
        OR metadata::text ILIKE $${likeQueryIndex}
      )`);
      values.push(options.limit, options.offset);
      const result = await client.query(
        `SELECT *, COUNT(*) OVER() AS total_count
         FROM alfred_memories
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC, id DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );
      const pagination =
        result.rows.length > 0
          ? paginationFrom(result.rows[0], options)
          : { limit: options.limit, offset: options.offset, total: await countMemories(client, where, values.slice(0, -2)) };
      return {
        items: result.rows.map(toMemory),
        pagination
      };
    },

    async get(userId, id) {
      const result = await client.query("SELECT * FROM alfred_memories WHERE user_id = $1 AND id = $2", [userId, id]);
      return toMemory(result.rows[0]);
    },

    async update(userId, id, patch) {
      const columns = [];
      const values = [userId, id];
      const fieldMap = {
        projectId: "project_id",
        type: "type",
        content: "content",
        tags: "tags",
        source: "source",
        metadata: "metadata",
        confidence: "confidence",
        expiresAt: "expires_at",
        updatedAt: "updated_at"
      };

      for (const [field, column] of Object.entries(fieldMap)) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
          values.push(field === "metadata" ? JSON.stringify(patch[field] ?? {}) : patch[field]);
          columns.push(`${column} = $${values.length}${field === "metadata" ? "::jsonb" : ""}`);
        }
      }

      const result = await client.query(
        `UPDATE alfred_memories
         SET ${columns.join(", ")}
         WHERE user_id = $1 AND id = $2
         RETURNING *`,
        values
      );
      return toMemory(result.rows[0]);
    },

    async delete(userId, id) {
      const result = await client.query("DELETE FROM alfred_memories WHERE user_id = $1 AND id = $2", [userId, id]);
      return result.rowCount > 0;
    }
  };
}
