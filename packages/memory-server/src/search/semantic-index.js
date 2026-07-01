// Semantic index: cosine similarity scoring and hybrid ranking.
//
// Pure functions. No DB access. The caller is responsible for fetching
// the embeddings from memory_embeddings and passing them in.
//
// Algorithm: cosine similarity between the query embedding and each
// stored embedding, returning a top-K list sorted by score desc.
//
// For hybrid ranking (RRF - Reciprocal Rank Fusion), the caller
// combines the semantic and keyword rankings. We use a constant k=60
// (the standard RRF constant).

export function cosineSimilarity(a, b) {
  if (!(a instanceof Float32Array) || !(b instanceof Float32Array)) {
    throw new TypeError("cosineSimilarity requires Float32Array inputs");
  }
  if (a.length !== b.length) {
    throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  }
  // Both vectors are assumed L2-normalized (the embedder uses normalize:true),
  // so cosine similarity reduces to dot product.
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

export function rankBySemanticScore({ queryEmbedding, candidates, topK = 20 }) {
  if (!(queryEmbedding instanceof Float32Array)) {
    return [];
  }
  const scored = [];
  for (const c of candidates) {
    if (!(c.embedding instanceof Float32Array)) continue;
    const score = cosineSimilarity(queryEmbedding, c.embedding);
    scored.push({ id: c.id, score, payload: c.payload });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// Reciprocal Rank Fusion: combine two ranked lists.
// Each list is an array of { id, score } sorted by score desc.
// The fused score for each id is sum(1 / (k + rank)) across both lists.
// Higher is better.
export function reciprocalRankFusion({ semanticRanking, keywordRanking, k = 60 }) {
  const scores = new Map();
  function add(ranking) {
    ranking.forEach((item, rank) => {
      const current = scores.get(item.id) ?? { id: item.id, score: 0, semanticRank: null, keywordRank: null, payload: item.payload };
      current.score += 1 / (k + rank + 1);
      if (item.score !== undefined) current.payload = item.payload;
      scores.set(item.id, current);
    });
  }
  if (semanticRanking && semanticRanking.length) {
    semanticRanking.forEach((item, rank) => { item.semanticRank = rank + 1; });
    add(semanticRanking);
  }
  if (keywordRanking && keywordRanking.length) {
    keywordRanking.forEach((item, rank) => { item.keywordRank = rank + 1; });
    add(keywordRanking);
  }
  const fused = [...scores.values()];
  fused.sort((a, b) => b.score - a.score);
  return fused;
}
