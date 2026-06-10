import { loadEmbeddingModel } from '../facerecg/faceEmbedding';
import {
  cosineSimilarity,
  VERIFICATION_THRESHOLD,
} from '../facerecg/faceCompare';
import { storageService } from './storageService';

export interface FaceMatchResult {
  success: boolean;
  studentId?: string;
  studentName?: string;
  message?: string;
}

export const faceService = {
  /**
   * Pre-loads the TFLite model so it is ready when the camera opens.
   *
   * BlazeFace (TF.js model) is NO LONGER loaded here.
   * Face detection is replaced by a center-crop in the native Kotlin module,
   * which is orders of magnitude faster on Android CPU.
   */
  async initializeModels() {
    console.log('[FaceService] Loading TFLite native model...');
    await loadEmbeddingModel();
    console.log('[FaceService] TFLite ready. Init complete.');
  },

  /**
   * Match a pre-computed embedding against locally cached student embeddings.
   * Called after the native Kotlin module returns the embedding from the image.
   *
   * This is pure JS math (no TF.js, no async I/O) so it runs in < 5ms.
   */
  matchEmbedding(embedding: number[]): FaceMatchResult {
    if (!embedding || embedding.length === 0) {
      return { success: false, message: '⚠️ Empty embedding — model error' };
    }

    const storedData = storageService.getObject('studentEmbeddings');

    if (!storedData || Object.keys(storedData).length === 0) {
      return {
        success: false,
        message: '⚠️ No student data synced. Check your Supabase connection.',
      };
    }

    let bestMatchId: string | null = null;
    let bestMatchName: string | null = null;
    let maxSimilarity = 0;

    // Compare against every registered student
    for (const [studentId, studentInfo] of Object.entries<any>(storedData)) {
      if (studentInfo.embedding) {
        const sim = cosineSimilarity(embedding, studentInfo.embedding);
        if (sim > maxSimilarity) {
          maxSimilarity = sim;
          bestMatchId = studentId;
          bestMatchName = studentInfo.name;
        }
      }
    }

    const isDevBypass = typeof __DEV__ !== 'undefined' && __DEV__;
    const hasMatched = bestMatchId && (maxSimilarity >= VERIFICATION_THRESHOLD || isDevBypass);

    if (hasMatched) {
      const matchPercent = (maxSimilarity * 100).toFixed(0);
      const devSuffix = isDevBypass && maxSimilarity < VERIFICATION_THRESHOLD ? ' (Dev Bypass)' : '';
      return {
        success: true,
        studentId: bestMatchId!,
        studentName: bestMatchName!,
        message: `✅ Identity Verified: ${bestMatchName}${devSuffix} (${matchPercent}%)`,
      };
    }

    return {
      success: false,
      message: `❌ Not recognized (Best: ${(maxSimilarity * 100).toFixed(0)}%)`,
    };
  },

  /**
   * Legacy method kept for compatibility.
   * The new fast path now uses matchEmbedding() directly.
   */
  async processFrame(): Promise<FaceMatchResult> {
    return {
      success: false,
      message: 'Use matchEmbedding() with the native fast path.',
    };
  },
};
