// Search service: composes embedder + semantic-index + a keyword store
// to provide searchMemories with mode: 'semantic' | 'keyword' | 'hybrid'.
//
// This is the public API used by the memory stores. It is decoupled
// from the actual memory store; the caller passes a `keywordSearch`
// function that the existing stores already implement (LIKE / ILIKE).

import { createEmbedder, embeddingToBuffer, bufferToEmbedding } from "./embedder.js";
import { rankBySemanticScore, reciprocalRankFusion } from "./semantic-index.js";

export function createSearchService({ embedder = null, embeddingStore = null, keywordSearch = null, log = console } = {}) {
  if (!embedder) embedder = createEmbedder();
  if (!embeddingStore) throw new TypeError("createSearchService requires embeddingStore");
  if (!keywordSearch) throw new TypeError("createSearchService requires keywordSearch");

  return {
    embedder,

    async index({ memoryId, tenantId, content }) {
      const embedding = await embedder.embed(content);
      if (!embedding) return { indexed: false, reason: "embedder_unavailable" };
      await embeddingStore.upsert({
        memory_id: memoryId,
        tenant_id: tenantId,
        model: embedder.modelName,
        dim: embedder.dim,
        embedding: embeddingToBuffer(embedding)
      });
      return { indexed: true, dim: embedder.dim };
    },

    async search({ tenantId, query, mode = "hybrid", limit = 20 }) {
      const result = { mode, items: [] };

      // Keyword ranking (always available).
      const keywordItems = await keywordSearch({ tenantId, query, limit: limit * 2 });
      const keywordRanking = keywordItems.map((item, rank) => ({ id: item.id, score: 1 / (rank + 1), payload: item }));

      if (mode === "keyword") {
        result.items = keywordItems.slice(0, limit);
        return result;
      }

      // Semantic ranking (requires embedder).
      let semanticRanking = [];
      if (embedder.isAvailable()) {
        const queryEmbedding = await embedder.embed(query);
        if (queryEmbedding) {
          const candidates = await embeddingStore.getByTenant(tenantId);
          semanticRanking = rankBySemanticScore({ queryEmbedding, candidates, topK: limit * 2 });
        }
      } else if (mode === "semantic") {
        log.warn?.("[search] embedder unavailable; semantic search returns empty");
      }

      if (mode === "semantic") {
        result.items = semanticRanking.map((r) => r.payload).slice(0, limit);
        return result;
      }

      // Hybrid (RRF).
      const fused = reciprocalRankFusion({ semanticRanking, keywordRanking });
      result.items = fused.slice(0, limit).map((f) => f.payload);
      return result;
    }
  };
}
