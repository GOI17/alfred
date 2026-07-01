// Local embedder using @xenova/transformers.
//
// The default model is Xenova/all-MiniLM-L6-v2: 22MB, 384-dim, MIT
// license. The model is downloaded once on first use and cached at
// ~/.cache/transformers/.
//
// The embedder is OPT-IN: callers must pass a model name. If the model
// fails to load (offline, missing dep), the embedder is marked
// unavailable and callers should fall back to keyword search.
//
// We intentionally do NOT bundle the model files in the npm package.
// The first user of searchMemories triggers the download. This keeps
// the install size small (the model is 22MB) and the server fast to
// boot.
//
// Zero provider calls. No network access except the one-time model
// download from huggingface.co.

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIM = 384;

export function createEmbedder({
  modelName = process.env.ALFRED_EMBEDDING_MODEL ?? DEFAULT_MODEL,
  dim = DEFAULT_DIM,
  transformersModule = null,
  log = console
} = {}) {
  let pipeline = null;
  let available = null; // null = unknown, true/false = resolved

  async function ensurePipeline() {
    if (available === false) return null;
    if (pipeline) return pipeline;
    try {
      if (!transformersModule) {
        // Dynamic import: the package is an optional dep.
        transformersModule = await import("@xenova/transformers");
      }
      const { pipeline: pl } = transformersModule;
      pipeline = await pl("feature-extraction", modelName);
      available = true;
      log.info?.(`[embedder] loaded model ${modelName} (dim=${dim})`);
      return pipeline;
    } catch (err) {
      available = false;
      log.warn?.(`[embedder] failed to load ${modelName}: ${err.message}. Semantic search will fall back to keyword.`);
      return null;
    }
  }

  return {
    modelName,
    dim,
    isAvailable: () => available === true,

    async embed(text) {
      if (typeof text !== "string" || text.length === 0) return null;
      const pl = await ensurePipeline();
      if (!pl) return null;
      try {
        const out = await pl(text, { pooling: "mean", normalize: true });
        // out is a Tensor; convert to plain Float32Array.
        return new Float32Array(out.data);
      } catch (err) {
        log.warn?.(`[embedder] embed failed: ${err.message}`);
        return null;
      }
    }
  };
}

// Helper: serialize a Float32Array to a Buffer for storage as BLOB.
export function embeddingToBuffer(arr) {
  if (!(arr instanceof Float32Array)) throw new TypeError("expected Float32Array");
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

// Helper: deserialize a Buffer to a Float32Array.
export function bufferToEmbedding(buf) {
  if (!Buffer.isBuffer(buf)) throw new TypeError("expected Buffer");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
