/**
 * faceCompare.ts
 * Compares two face embeddings using cosine similarity.
 */

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    console.warn(
      `cosineSimilarity: vectors must be non-empty and equal length (a.length=${a.length}, b.length=${b.length})`,
    );
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) {
    return 0;
  }

  // Clamp to [0, 1] — raw cosine can go to -1 but embeddings are mostly positive
  return Math.max(0, Math.min(1, dotProduct / magnitude));
}

/**
 * Verification threshold.
 * Similarity above this value = face verified.
 *
 * 0.48 is a good balance between security and real-world tolerance for unaligned crops:
 *   - Too high (0.6+) → rejects the real person due to lighting/angle/glasses variance
 *   - Too low (0.35-) → may accept imposters
 * For a controlled classroom setting 0.48 is extremely reliable without hardware alignment.
 */
export const VERIFICATION_THRESHOLD = 0.60;

/**
 * Checks if two embeddings represent the same person.
 */
export function isFaceMatch(a: number[], b: number[]): boolean {
  return cosineSimilarity(a, b) >= VERIFICATION_THRESHOLD;
}

/**
 * Averages multiple embeddings into a single embedding.
 */
export function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    return [];
  }
  const length = embeddings[0].length;
  const sum = new Array(length).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < length; i++) {
      sum[i] += emb[i];
    }
  }

  return sum.map(v => v / embeddings.length);
}
