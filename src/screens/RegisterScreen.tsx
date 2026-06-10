import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
} from 'react-native-vision-camera';
import { supabase } from '../services/supabaseClient';
import { NativeModules } from 'react-native';

const { TFLiteModule } = NativeModules;

// ─── Theme ──────────────────────────────────────────────────────────────────
const ACCENT = '#E53935'; // Vibrant Red
const BG = '#1C1C1E'; // Titanium Slate
const CARD_BG = '#2C2C2E'; // Graphite
const BORDER = '#3A3A3C'; // Metallic Border
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_SECONDARY = '#A1A1AA';

interface RegisterScreenProps {
  onBack: () => void;
}

export default function RegisterScreen({ onBack }: RegisterScreenProps) {
  // Form State
  const [studentUid, setStudentUid] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [name, setName] = useState('');
  const [course, setCourse] = useState('BTech');
  const [branch, setBranch] = useState('CSE');
  const [semester, setSemester] = useState('1');
  const [section, setSection] = useState('A');

  // Camera & Image State
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);

  // Status State
  const [isRegistering, setIsRegistering] = useState(false);

  const cameraRef = useRef<Camera>(null);
  const device = useCameraDevice('front');
  const format = useCameraFormat(device, [
    { photoResolution: { width: 640, height: 480 } },
    { videoResolution: { width: 640, height: 480 } },
    { fps: 30 },
  ]);

  // Request permissions on mount
  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasCameraPermission(status === 'granted');
    })();
  }, []);

  // Capture Photo
  const handleCapture = async () => {
    if (!cameraRef.current) {
      Alert.alert('Camera Error', 'Camera not ready.');
      return;
    }
    try {
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: false,
        qualityPrioritization: 'speed',
      });
      setCapturedPhoto(photo.path);
      setShowCamera(false);
    } catch (e: any) {
      Alert.alert('Capture Failed', e.message || 'Failed to capture photo.');
    }
  };

  // Submit Registration
  const handleSubmit = async () => {
    // Validate inputs
    if (!studentUid.trim()) return Alert.alert('Validation Error', 'Student UID is required.');
    if (!rollNumber.trim()) return Alert.alert('Validation Error', 'Roll Number is required.');
    if (!name.trim()) return Alert.alert('Validation Error', 'Full Name is required.');
    if (!capturedPhoto) return Alert.alert('Validation Error', 'Face photo is required. Please capture photo.');

    const parsedSem = parseInt(semester, 10);
    if (isNaN(parsedSem)) return Alert.alert('Validation Error', 'Semester must be a valid number.');

    setIsRegistering(true);

    let photoPath = capturedPhoto.startsWith('file://')
      ? capturedPhoto.slice(7)
      : capturedPhoto;

    try {
      // 1. Extract embedding using native TFLite module
      console.log('[RegisterScreen] Running face embedding extraction on photo:', photoPath);
      const { embedding } = await TFLiteModule.recognizeFaceFromFile(photoPath);

      if (!embedding || embedding.length === 0) {
        throw new Error('Could not extract face embedding. Ensure your face is fully visible.');
      }

      // 2. Insert/Upsert into Supabase students table
      console.log('[RegisterScreen] Upserting to Supabase...');
      const { error } = await supabase
        .from('students')
        .upsert(
          {
            student_uid: studentUid.trim(),
            roll_number: rollNumber.trim(),
            name: name.trim(),
            course: course.trim(),
            branch: branch.trim(),
            semester: parsedSem,
            section: section.trim(),
            face_embedding: embedding,
          },
          { onConflict: 'student_uid' }
        );

      if (error) {
        throw new Error(`Supabase error ${error.code ?? ''}: ${error.message}`);
      }

      Alert.alert(
        'Success',
        `Student '${name}' registered successfully!`,
        [{ text: 'OK', onPress: onBack }]
      );
    } catch (err: any) {
      console.error('[RegisterScreen] Registration failed:', err);
      Alert.alert('Registration Failed', err.message || 'An error occurred.');
    } finally {
      setIsRegistering(false);
      // Clean up temp photo file
      if (photoPath) {
        try {
          const RNFS = require('react-native-fs').default;
          RNFS.unlink(photoPath).catch(() => {});
        } catch (_) {}
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Student Registration</Text>
          <Text style={styles.subtitle}>Create profile and enroll biometric face embedding</Text>
        </View>

        {showCamera ? (
          /* Camera View */
          <View style={styles.cameraContainer}>
            {!hasCameraPermission ? (
              <Text style={styles.errorText}>Camera permission not granted.</Text>
            ) : !device ? (
              <Text style={styles.errorText}>Front camera not found.</Text>
            ) : (
              <View style={styles.cameraFrame}>
                <Camera
                  style={StyleSheet.absoluteFill}
                  ref={cameraRef}
                  device={device}
                  format={format}
                  isActive={true}
                  photo={true}
                  resizeMode="cover"
                />
                <View style={styles.cameraOverlay}>
                  <Text style={styles.cameraGuideText}>Center face in the frame</Text>
                </View>
              </View>
            )}
            <View style={styles.cameraControls}>
              <TouchableOpacity style={styles.captureBtn} onPress={handleCapture}>
                <View style={styles.captureBtnInner} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelCameraBtn} onPress={() => setShowCamera(false)}>
                <Text style={styles.cancelCameraText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Form & Photo Selector View */
          <View style={styles.formContainer}>
            {/* Photo Capture Section */}
            <View style={styles.photoSection}>
              {capturedPhoto ? (
                <View style={styles.photoPreviewContainer}>
                  <Image source={{ uri: `file://${capturedPhoto}` }} style={styles.photoPreview} />
                  <TouchableOpacity style={styles.recaptureBtn} onPress={() => setShowCamera(true)}>
                    <Text style={styles.recaptureText}>Retake Photo</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.captureTrigger} onPress={() => setShowCamera(true)}>
                  <Text style={styles.captureTriggerIcon}>📸</Text>
                  <Text style={styles.captureTriggerText}>Capture Face Biometrics</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Inputs */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Student UID / DB Key</Text>
              <TextInput
                style={styles.input}
                value={studentUid}
                onChangeText={setStudentUid}
                placeholder="e.g. 21006"
                placeholderTextColor="#666"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Roll Number</Text>
              <TextInput
                style={styles.input}
                value={rollNumber}
                onChangeText={setRollNumber}
                placeholder="e.g. 23L31A4465"
                placeholderTextColor="#666"
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Nitish Kumar"
                placeholderTextColor="#666"
              />
            </View>

            {/* Row fields */}
            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.inputLabel}>Course</Text>
                <TextInput
                  style={styles.input}
                  value={course}
                  onChangeText={setCourse}
                  placeholder="e.g. BTech"
                  placeholderTextColor="#666"
                />
              </View>

              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Branch</Text>
                <TextInput
                  style={styles.input}
                  value={branch}
                  onChangeText={setBranch}
                  placeholder="e.g. CSE"
                  placeholderTextColor="#666"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.inputLabel}>Semester</Text>
                <TextInput
                  style={styles.input}
                  value={semester}
                  onChangeText={setSemester}
                  placeholder="e.g. 1"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                />
              </View>

              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Section</Text>
                <TextInput
                  style={styles.input}
                  value={section}
                  onChangeText={setSection}
                  placeholder="e.g. A"
                  placeholderTextColor="#666"
                  autoCapitalize="characters"
                />
              </View>
            </View>

            {/* Buttons */}
            <TouchableOpacity
              style={[styles.submitBtn, isRegistering && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={isRegistering}
            >
              {isRegistering ? (
                <ActivityIndicator color="#1C1C1E" />
              ) : (
                <Text style={styles.submitBtnText}>Submit Registration</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.backBtn} onPress={onBack} disabled={isRegistering}>
              <Text style={styles.backBtnText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContainer: {
    padding: 24,
    paddingBottom: 60,
  },
  header: {
    marginTop: 40,
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_PRIMARY,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    marginTop: 6,
  },
  cameraContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  cameraFrame: {
    width: 280,
    height: 280,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 16,
  },
  cameraGuideText: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 'bold',
  },
  cameraControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    width: '100%',
    justifyContent: 'center',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#fff',
  },
  cancelCameraBtn: {
    position: 'absolute',
    right: 20,
  },
  cancelCameraText: {
    color: TEXT_SECONDARY,
    fontSize: 15,
    fontWeight: 'bold',
  },
  formContainer: {
    width: '100%',
  },
  photoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  captureTrigger: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: 'dashed',
    backgroundColor: CARD_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureTriggerIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  captureTriggerText: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: 'bold',
  },
  photoPreviewContainer: {
    alignItems: 'center',
    width: '100%',
  },
  photoPreview: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: ACCENT,
  },
  recaptureBtn: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: BORDER,
  },
  recaptureText: {
    color: TEXT_PRIMARY,
    fontSize: 12,
    fontWeight: 'bold',
  },
  inputGroup: {
    marginBottom: 16,
    width: '100%',
  },
  inputLabel: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT_PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    width: '100%',
  },
  submitBtn: {
    backgroundColor: TEXT_PRIMARY,
    width: '100%',
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  submitBtnText: {
    color: BG,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  backBtn: {
    width: '100%',
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  backBtnText: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: 'bold',
  },
  errorText: {
    color: ACCENT,
    textAlign: 'center',
    padding: 20,
  },
});
