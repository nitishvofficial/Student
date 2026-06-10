import * as tf from '@tensorflow/tfjs';
import { NativeModules } from 'react-native';
import { Asset } from 'expo-asset';

const { TFLiteModule } = NativeModules;

let modelLoaded = false;

/**
 * Load and cache the MobileFaceNet TFLite model using the native TFLite Java API.
 * Uses expo-asset to resolve the bundled .tflite file to a local path,
 * then passes it to our custom Kotlin TFLiteModule for native inference.
 */
export async function loadEmbeddingModel(): Promise<void> {
  if (modelLoaded) {
    return;
  }

  console.log('[FaceEmbedding] Starting loadEmbeddingModel attempt...');
  try {
    // Force a small delay to ensure native modules are ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // STRATEGY 1: Load from Native Android Assets (Most robust for release builds)
    try {
      console.log('[FaceEmbedding] Attempt 1: Loading from Native Assets...');
      // Note: This path refers to android/app/src/main/assets/
      await TFLiteModule.loadModelFromAssets('models/mobilefacenet.tflite');
      console.log('[FaceEmbedding] SUCCESS: Loaded via Native Assets.');
      modelLoaded = true;
      return;
    } catch (assetErr) {
      console.warn(
        '[FaceEmbedding] Native Asset load failed, falling back to Strategy 2:',
        assetErr,
      );
    }

    // STRATEGY 2: Load via Expo-Asset (Fallback for development/complex cases)
    try {
      console.log('[FaceEmbedding] Attempt 2: Resolving via Expo-Asset...');
      // Wrap the require in a try to catch registry errors immediately
      const assetModule = require('../../assets/models/mobilefacenet.tflite');
      console.log('[FaceEmbedding] Asset required ID:', assetModule);

      const asset = Asset.fromModule(assetModule);
      console.log('[FaceEmbedding] Resolving via expo-asset:', asset.uri);

      await asset.downloadAsync();
      const localUri = asset.localUri || asset.uri;
      console.log('[FaceEmbedding] Target URI:', localUri);

      if (!localUri) {
        throw new Error('Could not resolve TFLite asset local path.');
      }

      await TFLiteModule.loadModel(localUri);
      console.log('[FaceEmbedding] SUCCESS: Loaded via local URI.');
      modelLoaded = true;
    } catch (expoErr: any) {
      console.error('[FaceEmbedding] Strategy 2 failed:', expoErr);
      throw new Error(
        `Failed to load TFLite model. Native error: ${
          expoErr.message || expoErr
        }`,
      );
    }
  } catch (error) {
    console.error('[FaceEmbedding] FATAL ERROR:', error);
    throw error;
  }
}

/**
 * Generate a 128-dim embedding vector from a 112x112 Tensor3D.
 * Normalises input to [-1, 1], runs native TFLite inference, returns first 128 dims.
 */
export async function getEmbedding(tensor112: tf.Tensor3D): Promise<number[]> {
  await loadEmbeddingModel();

  // Normalise to [-1, 1] and add batch dimension: [1, 112, 112, 3]
  const normalizedTensor = tf.tidy(() => {
    let t = tf.cast(tensor112, 'float32');
    t = tf.div(tf.sub(t, 127.5), 128.0);
    return tf.expandDims(t, 0);
  });

  const inputData = await normalizedTensor.data();
  normalizedTensor.dispose();

  // Convert to regular JS array for the NativeModules bridge
  const inputArray = Array.from(inputData);

  // Run native TFLite inference
  const outputArray: number[] = await TFLiteModule.runInference(inputArray);

  // MobileFaceNet may output 192 dims — we slice to 128 to match stored embeddings
  const raw128 = outputArray.slice(0, 128);

  // L2-normalize so cosine similarity is reliable (unit-sphere comparison)
  // The stored embeddings in Supabase are also normalized, so both vectors
  // must be in the same space for a meaningful similarity score.
  const norm = Math.sqrt(raw128.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? raw128.map(v => v / norm) : raw128;
}

/**
 * Normalise an embedding vector to unit length (L2 norm).
 */
export function normalizeEmbedding(embedding: number[]): number[] {
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) {
    return embedding;
  }
  return embedding.map(v => v / norm);
}
