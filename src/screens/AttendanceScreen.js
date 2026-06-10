/**
 * AttendanceScreen.js - AM_Student [PREMIUM BLE EXPERIENCE]
 *
 * Flow:
 *  1. Face Verified (Prev Screen) -> 2. Proximity Scan -> 3. JOIN (Roll No) -> 4. OTP Check
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import StudentBLEModule from '../ble/StudentBLEModule';

// ─── Theme (Titanium Slate / Graphite Aesthetic) ──────────────────────────────
const ACCENT = '#FF3B30'; // Vibrant Red
const SUCCESS = '#34C759'; // iOS Success Green
const BG = '#1C1C1E'; // Titanium Slate (Dark Grey, not Black)
const CARD_BG = '#2C2C2E'; // Graphite Surface
const BORDER = '#3A3A3C'; // Metallic Border
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_SECONDARY = '#A1A1AA'; // Silver Grey

// ─── Component ────────────────────────────────────────────────────────────────
export default function AttendanceScreen({ studentUser }) {
  const [phase, setPhase] = useState('idle'); // idle, scanning, joining, otp, confirming, done, rejected
  const [sessions, setSessions] = useState([]);
  const [otpInput, setOtpInput] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [otpError, setOtpError] = useState('');
  const [rejectedReason, setRejectedReason] = useState('');

  const callbacksRef = useRef({});

  useEffect(() => {
    let mounted = true;
    const initBLE = async () => {
      try {
        await StudentBLEModule.initialize();
      } catch (err) {
        if (mounted) {
          Alert.alert(
            'Bluetooth Error',
            'Please enable Bluetooth and Location permissions.',
          );
        }
      }
    };
    initBLE();
    return () => {
      mounted = false;
      StudentBLEModule.destroy().catch(() => {});
    };
  }, []);

  // ── Scan ────────────────────────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    setSessions([]);
    setOtpInput('');
    setRejectedReason('');
    setOtpError('');

    setPhase('scanning');
    setStatusMsg('Searching for Faculty signals...');
    try {
      await StudentBLEModule.scanForSessions(live => {
        // Sort by signal strength (strongest first)
        const sorted = [...live].sort(
          (a, b) => (b.rssi || -999) - (a.rssi || -999),
        );
        setSessions(sorted);
      });
      setStatusMsg('Nearby active classes');
    } catch (err) {
      Alert.alert('Scan Failed', err.message || 'Bluetooth scanning error.');
      setPhase('idle');
    }
  }, []);

  const handleStopScan = useCallback(() => {
    StudentBLEModule.stopScan();
    setPhase('idle');
  }, []);

  // ── Select session — Handshake Start ──────────────────────────────────────
  const handleSelectSession = useCallback(
    async session => {
      if (phase !== 'scanning') {
        return;
      }

      StudentBLEModule.stopScan();
      setPhase('joining');
      setStatusMsg('Establishing secure link...');

      callbacksRef.current = {
        onJoinSent: () =>
          setStatusMsg('Identification sent. Requesting OTP...'),
        onOTPRequested: () => {
          setPhase('otp');
          setOtpError('');
          setStatusMsg('Faculty requested manual code verification.');
        },
        onOTPWrong: () => {
          setPhase('otp');
          setOtpInput('');
          setOtpError('❌ INVALID OTP');
          setStatusMsg('The code provided does not match.');
        },
        onAttendanceConfirmed: () => {
          setPhase('done');
          setStatusMsg('Attendance Logged Successfully.');
        },
        onRejected: humanMessage => {
          setRejectedReason(humanMessage);
          setPhase('rejected');
        },
        onDisconnected: () => {
          if (phase !== 'done' && phase !== 'rejected') {
            Alert.alert(
              'Link Dropped',
              'The faculty device disconnected unexpectedly.',
            );
            setPhase('idle');
          }
        },
        onError: err => {
          Alert.alert('BLE System Error', err.message || 'Connection failed.');
          setPhase('idle');
        },
      };

      /**
       * CRITICAL: Using Roll Number as the ID for the JOIN handshake.
       * This triggers the checkbox in the Faculty app list.
       */
      const rollNo = studentUser?.rollNo || studentUser?.uid || 'UNKNOWN';
      try {
        await StudentBLEModule.joinSession(
          session.deviceId,
          rollNo,
          callbacksRef.current,
        );
      } catch (err) {
        Alert.alert('Handshake Failed', 'Could not establish connection.');
        setPhase('idle');
      }
    },
    [phase, studentUser],
  );

  // ── OTP verify ──────────────────────────────────────────────────────────────
  const handleVerifyOTP = useCallback(async () => {
    if (otpInput.length !== 4) {
      setOtpError('Enter 4 digits');
      return;
    }
    setPhase('confirming');
    setOtpError('');
    try {
      await StudentBLEModule.submitOTP(otpInput, () => {
        setPhase('otp');
        setOtpError('Failed to send');
      });
    } catch (err) {
      setPhase('otp');
      setOtpError('Submission Error');
    }
  }, [otpInput]);

  const handleReset = useCallback(() => {
    setPhase('idle');
    setOtpInput('');
    setSessions([]);
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" />

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>ACADEMIC MONITOR</Text>
        <Text style={styles.appSubtitle}>BIOMETRIC PROXIMITY HANDSHAKE</Text>
        <View style={styles.studentBadge}>
          <Text style={styles.studentName}>
            {studentUser?.name || 'STUDENT'}
          </Text>
          <Text style={styles.studentRoll}>
            {studentUser?.rollNo || studentUser?.uid}
          </Text>
        </View>
      </View>

      {/* ── IDLE ────────────────────────────────────────────────────────── */}
      {phase === 'idle' && (
        <View style={styles.centerContent}>
          <TouchableOpacity style={styles.mainCircleBtn} onPress={handleScan}>
            <Text style={styles.circleBtnTxt}>SCAN</Text>
          </TouchableOpacity>
          <Text style={styles.hintTxt}>
            Proximity detection required to mark attendance
          </Text>
        </View>
      )}

      {/* ── SCANNING ────────────────────────────────────────────────────── */}
      {phase === 'scanning' && (
        <View style={styles.fullWidth}>
          <View style={styles.statusRow}>
            <ActivityIndicator color={ACCENT} size="small" />
            <Text style={styles.statusTxt}>{statusMsg}</Text>
          </View>

          <FlatList
            data={sessions}
            keyExtractor={item => item.deviceId}
            contentContainerStyle={styles.listContainer}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.sessionCard,
                  !item.isNearby && styles.cardDimmed,
                ]}
                onPress={() => handleSelectSession(item)}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardSubject}>{item.subject}</Text>
                  <Text
                    style={[
                      styles.cardRssi,
                      { color: item.isNearby ? SUCCESS : TEXT_SECONDARY },
                    ]}
                  >
                    {item.rssi} dBm
                  </Text>
                </View>
                <Text style={styles.cardInfo}>
                  {item.branch} • SEMESTER {item.semester}
                </Text>
                {!item.isNearby && (
                  <Text style={styles.distalWarning}>
                    ⚠️ SIGNAL WEAK - MOVE CLOSER
                  </Text>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyTxt}>NO ACTIVE SESSIONS FOUND</Text>
              </View>
            }
          />
          <TouchableOpacity style={styles.ghostBtn} onPress={handleStopScan}>
            <Text style={styles.ghostBtnTxt}>STOP SCAN</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── JOINING / CONFIRMING ────────────────────────────────────────── */}
      {(phase === 'joining' || phase === 'confirming') && (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.phaseTxt}>{statusMsg}</Text>
        </View>
      )}

      {/* ── OTP ENTRY ──────────────────────────────────────────────────── */}
      {phase === 'otp' && (
        <View style={styles.fullWidth}>
          <Text style={styles.otpLabel}>ENTER SESSION PIN</Text>
          <Text style={styles.otpHint}>Provided by the instructor</Text>
          <TextInput
            style={[styles.otpInput, otpError ? styles.otpInputError : null]}
            value={otpInput}
            onChangeText={t => setOtpInput(t.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            textAlign="center"
            autoFocus
            placeholder="0000"
            placeholderTextColor="#333"
          />
          {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}
          <TouchableOpacity style={styles.actionBtn} onPress={handleVerifyOTP}>
            <Text style={styles.actionBtnTxt}>VERIFY PIN</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtn} onPress={handleReset}>
            <Text style={styles.backBtnTxt}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── REJECTED ───────────────────────────────────────────────────── */}
      {phase === 'rejected' && (
        <View style={styles.centerContent}>
          <Text style={styles.bigIcon}>⛔</Text>
          <Text style={styles.blockTitle}>ACCESS DENIED</Text>
          <Text style={styles.blockReason}>{rejectedReason}</Text>
          <TouchableOpacity style={styles.actionBtn} onPress={handleReset}>
            <Text style={styles.actionBtnTxt}>TRY AGAIN</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── DONE ────────────────────────────────────────────────────────── */}
      {phase === 'done' && (
        <View style={styles.centerContent}>
          <Text style={styles.bigIcon}>✅</Text>
          <Text style={styles.successTitle}>VERIFIED</Text>
          <Text style={styles.successSub}>Attendance record processed</Text>
          <TouchableOpacity style={styles.ghostBtn} onPress={handleReset}>
            <Text style={styles.ghostBtnTxt}>DISMISS</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG, padding: 24 },

  header: { marginTop: 40, marginBottom: 40 },
  appTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_PRIMARY,
    letterSpacing: 3,
  },
  appSubtitle: {
    fontSize: 10,
    color: TEXT_SECONDARY,
    letterSpacing: 1.5,
    marginBottom: 20,
  },
  studentBadge: {
    borderLeftWidth: 2,
    borderLeftColor: ACCENT,
    paddingLeft: 12,
  },
  studentName: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  studentRoll: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mainCircleBtn: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
    borderColor: BORDER,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#3A3A3C', // Titanium Mid-tone
  },
  circleBtnTxt: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 4,
  },
  hintTxt: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    marginTop: 40,
    textAlign: 'center',
  },

  fullWidth: { flex: 1 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    justifyContent: 'center',
  },
  statusTxt: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 8,
    textTransform: 'uppercase',
  },

  listContainer: { paddingBottom: 20 },
  sessionCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginBottom: 16,
    borderRadius: 8,
  },
  cardDimmed: { opacity: 0.5 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardSubject: { fontSize: 16, fontWeight: '900', color: TEXT_PRIMARY },
  cardRssi: { fontSize: 10, fontWeight: '700' },
  cardInfo: { fontSize: 12, color: TEXT_SECONDARY },
  distalWarning: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: '900',
    marginTop: 12,
  },

  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyTxt: { color: '#333', fontSize: 12, fontWeight: '700' },

  phaseTxt: { color: TEXT_SECONDARY, marginTop: 20, fontSize: 12 },

  // OTP
  otpLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: TEXT_SECONDARY,
    textAlign: 'center',
  },
  otpHint: {
    fontSize: 10,
    color: '#444',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  otpInput: {
    fontSize: 60,
    color: TEXT_PRIMARY,
    letterSpacing: 10,
    padding: 20,
    backgroundColor: '#3A3A3C', // Titanium Mid-tone
    borderRadius: 12,
    marginBottom: 30,
    fontWeight: '300',
    borderWidth: 1,
    borderColor: BORDER,
  },
  otpInputError: { borderColor: ACCENT, borderWidth: 1 },
  errorText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },

  actionBtn: {
    backgroundColor: TEXT_PRIMARY,
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnTxt: {
    color: BG,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },

  ghostBtn: { padding: 16, alignItems: 'center', marginTop: 12 },
  ghostBtnTxt: { color: TEXT_SECONDARY, fontSize: 11, fontWeight: '700' },

  backBtn: { padding: 16, alignItems: 'center', marginTop: 8 },
  backBtnTxt: { color: '#444', fontSize: 11 },

  bigIcon: { fontSize: 64, marginBottom: 20 },
  blockTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: TEXT_PRIMARY,
    marginBottom: 8,
  },
  blockReason: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 40,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_PRIMARY,
    marginBottom: 4,
  },
  successSub: { color: SUCCESS, fontSize: 12, fontWeight: '700' },
});
