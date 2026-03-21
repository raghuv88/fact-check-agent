// Use dynamic import to avoid ESM resolution issues with @xenova/transformers
let embedderInstance: any = null;

/**
 * Lazy-load the embedding model.
 * First call takes ~2-3 seconds (downloads ~80MB model on first run ever).
 * Subsequent calls within the same process return instantly.
 */
async function getEmbedder(): Promise<any> {
  if (!embedderInstance) {
    console.log('[Embedder] Loading all-MiniLM-L6-v2 model...');
    const { pipeline } = await import('@xenova/transformers');
    embedderInstance = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
    );
    console.log('[Embedder] Model loaded successfully');
  }
  return embedderInstance;
}

/**
 * Generate embeddings for an array of claim texts.
 * Returns L2-normalized vectors (384 dimensions each).
 * Normalized vectors allow cosine similarity = simple dot product.
 *
 * @param texts - Array of claim strings to embed
 * @returns Array of number[] vectors (same order as input)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const embedder = await getEmbedder();
  const vectors: number[][] = [];

  for (const text of texts) {
    const result = await embedder(text, {
      pooling: 'mean',
      normalize: true,
    });
    // result.data is a Float32Array — convert to plain number[]
    vectors.push(Array.from(result.data) as number[]);
  }

  return vectors;
}

/**
 * Generate embedding for a single text.
 * Convenience wrapper around generateEmbeddings.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [vector] = await generateEmbeddings([text]);
  return vector;
}
