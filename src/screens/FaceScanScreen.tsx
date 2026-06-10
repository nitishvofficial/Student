import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
} from 'react-native-vision-camera';
import { useFaceRecognition } from '../hooks/useFaceRecognition';
import { studentService } from '../services/studentService';

/**
 * FaceScanScreen
 * Step 1 of the attendance flow: Face → BLE → OTP
 *
 * Uses react-native-vision-camera in photo-capture mode.
 * A polling loop inside useFaceRecognition() takes a photo every 500ms,
 * runs the TF.js face pipeline, and matches against local MMKV embeddings.
 */
export default function FaceScanScreen({
  onLogin,
  onNavigateToRegister,
}: {
  onLogin: (student: any) => void;
  onNavigateToRegister: () => void;
}) {
  const [hasPermission, setHasPermission] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const device = useCameraDevice('front');
  // Request a 640x480 format for both video and photo.
  // This applies to takeSnapshot() (which uses the video stream)
  // so each captured frame is small (~100KB), not the full camera resolution (3-12MP).
  const format = useCameraFormat(device, [
    { photoResolution: { width: 640, height: 480 } },
    { videoResolution: { width: 640, height: 480 } },
    { fps: 30 },
  ]);

  const {
    cameraRef,
    isModelsLoaded,
    error,
    isScanning,
    setIsScanning,
    scanResult,
  } = useFaceRecognition();

  // Request camera permission and sync student data on mount
  const doSync = async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const { count } = await studentService.syncStudentEmbeddings();
      console.log(`[FaceScanScreen] Sync OK — ${count} student(s) loaded.`);
    } catch (err: any) {
      const msg = err?.message || 'Unknown sync error';
      console.error('[FaceScanScreen] Sync failed:', msg);
      setSyncError(msg);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
      await doSync();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Transition on successful match
  useEffect(() => {
    if (scanResult?.success && scanResult.studentId) {
      const verifiedStudent = {
        uid: scanResult.studentId,
        name: scanResult.studentName || 'Verified Student',
        rollNo: scanResult.studentId,
        branch: 'Verified',
        semester: 'Verified',
      };
      setTimeout(() => onLogin(verifiedStudent), 1500);
    }
  }, [scanResult, onLogin]);

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>
          Camera permission is required to verify identity.
        </Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>No front camera found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.title}>Identity Verification</Text>
          {error ? (
            <Text style={[styles.subtitle, styles.errorText]}>
              AI Error: {error}
            </Text>
          ) : !isModelsLoaded ? (
            <Text style={styles.subtitle}>Loading AI Models…</Text>
          ) : (
            <Text style={styles.subtitle}>
              Position your face in the centre
            </Text>
          )}
        </View>

        {/* Sync error banner with Retry */}
        {syncError && (
          <View style={styles.syncErrorBanner}>
            <Text style={styles.syncErrorTitle}>⚠️ Sync Failed</Text>
            <Text style={styles.syncErrorMsg}>{syncError}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={doSync}
              disabled={isSyncing}
            >
              <Text style={styles.retryBtnText}>
                {isSyncing ? 'Retrying…' : '🔄 Retry Sync'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Face framing box - NOW ISOLATES THE CAMERA FEED */}
        <View
          style={[
            styles.frameBox,
            scanResult?.success && styles.frameBoxSuccess,
            { overflow: 'hidden' }
          ]}
        >
          <Camera
            style={StyleSheet.absoluteFill}
            ref={cameraRef}
            device={device}
            format={format}
            isActive={!scanResult?.success}
            photo={true}
            resizeMode="cover"
          />
        </View>

        <View style={styles.footer}>
          {scanResult?.success && (
            <View style={[styles.resultBox, styles.resultSuccess]}>
              <Text style={styles.resultText}>{scanResult.message}</Text>
            </View>
          )}

          {!scanResult?.success && (
            <View style={{ width: '100%' }}>
              <TouchableOpacity
                style={[
                  styles.button,
                  (!isModelsLoaded || isScanning) && styles.buttonDisabled,
                ]}
                disabled={!isModelsLoaded || isScanning}
                onPress={() => setIsScanning(true)}
              >
                {isScanning ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Start Scan</Text>
                )}
              </TouchableOpacity>
              
              {!isScanning && (
                <TouchableOpacity
                  style={styles.registerButton}
                  onPress={onNavigateToRegister}
                >
                  <Text style={styles.registerButtonText}>Register New Student</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: 24,
    zIndex: 10,
  },
  header: { alignItems: 'center', marginTop: 40 },
  title: { fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  subtitle: { fontSize: 14, color: '#aaa', marginTop: 8 },
  errorText: { color: '#ff5555' },
  frameBox: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 20,
    alignSelf: 'center',
    backgroundColor: 'transparent',
  },
  frameBoxSuccess: { borderColor: '#00FF00', borderWidth: 4 },
  footer: { width: '100%', paddingBottom: 40, alignItems: 'center' },
  resultBox: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
    width: '100%',
    alignItems: 'center',
  },
  resultSuccess: {
    backgroundColor: 'rgba(0, 255, 0, 0.2)',
    borderWidth: 1,
    borderColor: '#00FF00',
  },
  resultFail: {
    backgroundColor: 'rgba(255, 0, 0, 0.2)',
    borderWidth: 1,
    borderColor: '#FF0000',
  },
  resultText: { color: '#fff', fontWeight: 'bold' },
  button: {
    backgroundColor: '#E53935',
    width: '100%',
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#555' },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  registerButton: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E53935',
    width: '100%',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  registerButtonText: {
    color: '#E53935',
    fontSize: 15,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  syncErrorBanner: {
    backgroundColor: 'rgba(200, 0, 0, 0.85)',
    borderRadius: 10,
    padding: 14,
    marginHorizontal: 8,
    alignItems: 'center',
  },
  syncErrorTitle: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
    marginBottom: 4,
  },
  syncErrorMsg: {
    color: '#ffd0d0',
    fontSize: 12,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  retryBtnText: {
    color: '#cc0000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  text: { color: '#fff', textAlign: 'center', padding: 20 },
});
