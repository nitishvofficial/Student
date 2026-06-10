import { useState, useCallback, useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
import { faceService, FaceMatchResult } from '../services/faceService';
import type { Camera } from 'react-native-vision-camera';

const { TFLiteModule } = NativeModules;

/**
 * Hook for fast face scanning.
 *
 * ARCHITECTURE (all-native fast path):
 *   1. camera.takePhoto() — capture image
 *   2. TFLiteModule.recognizeFaceFromFile(path) — single native call that:
 *        a. Reads the JPEG with BitmapFactory (native I/O, much faster than RNFS+base64)
 *        b. Fixes EXIF rotation
 *        c. Center-crops and resizes to 112x112
 *        d. Normalizes to [-1, 1]
 *        e. Runs MobileFaceNet TFLite inference
 *        f. L2-normalizes the output embedding
 *      No TF.js, no BlazeFace, no JS bridge image transfer.
 *   3. faceService.matchEmbedding(embedding) — compare against MMKV store
 *
 * Why this is fast:
 *   - Old path: RNFS read (~2s for 5MB) + TF.js decodeJpeg + BlazeFace on CPU (~3s) = ~5-8s/frame
 *   - New path: Native BitmapFactory read (~50ms) + TFLite (~100ms) = ~200ms/frame
 */
export function useFaceRecognition() {
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<FaceMatchResult | null>(null);
  const cameraRef = useRef<Camera>(null);
  const scanningRef = useRef(false);

  // Load only the TFLite model on mount.
  // BlazeFace is no longer needed — face detection is replaced by center crop.
  useEffect(() => {
    let mounted = true;
    const loadModels = async () => {
      try {
        await faceService.initializeModels();
        if (mounted) setIsModelsLoaded(true);
      } catch (e: any) {
        console.error('[FaceRecognition] Failed to load TFLite model:', e);
        if (mounted) setError(e.message || 'Failed to load AI model');
      }
    };
    loadModels();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    scanningRef.current = isScanning;
  }, [isScanning]);

  const startScanLoop = useCallback(async () => {
    console.log('[FaceScanLoop] Starting fast-path loop');

    while (scanningRef.current) {
      let photoPath: string | null = null;

      try {
        const camera = cameraRef.current;
        if (!camera) {
          setIsScanning(false);
          break;
        }

        // 1. Capture photo
        setScanResult({ success: false, message: '📸 Capturing...' });
        const photo = await camera.takePhoto({
          flash: 'off',
          enableShutterSound: false,
          qualityPrioritization: 'speed',
        });

        photoPath = photo.path.startsWith('file://')
          ? photo.path.slice(7)
          : photo.path;

        // 2. Run the entire face recognition pipeline in native Kotlin.
        setScanResult({ success: false, message: '🧠 Analyzing...' });
        const { embedding } = await TFLiteModule.recognizeFaceFromFile(photoPath);

        // 3. Match the embedding against MMKV-cached student embeddings
        const result = await faceService.matchEmbedding(embedding);
        setScanResult(result);

        if (result.success) {
          console.log('[FaceRecognition] SUCCESS');
          scanningRef.current = false;
          setIsScanning(false);
          break;
        }

      } catch (err: any) {
        console.error('[FaceScanLoop] Error:', err);
        setScanResult({
          success: false,
          message: `⚠️ ${err.message || 'Scan error — please try again'}`,
        });
      } finally {
        // Clean up temp photo after processing
        if (photoPath) {
          try {
            const RNFS = require('react-native-fs').default;
            RNFS.unlink(photoPath).catch(() => {});
          } catch (_) {}
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('[FaceScanLoop] Loop exited');
  }, []);

  useEffect(() => {
    if (isScanning && isModelsLoaded) {
      startScanLoop();
    }
  }, [isScanning, isModelsLoaded, startScanLoop]);

  return {
    cameraRef,
    isModelsLoaded,
    error,
    isScanning,
    setIsScanning,
    scanResult,
    setScanResult,
  };
}
