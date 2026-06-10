/**
 * Security: OTP-based verification only.
 */

import { Buffer } from 'buffer';
import {
  AM_SERVICE_UUID,
  FACULTY_TO_STUDENT_CHAR_UUID,
  STUDENT_TO_FACULTY_CHAR_UUID,
  SCAN_DURATION_MS,
  MSG,
} from './BLEConstants';
import { BLEService } from './BLEService';
import {
  buildJoinMessage,
  isDeviceCloseEnough,
  friendlyRejectionMessage,
} from './SecurityUtils';

const TAG = '[AM_Student][StudentBLEModule]';

class StudentBLEModuleClass {
  _scanTimer = null;
  _disconnectSub = null;

  // ─── Public API ─────────────────────────────────────────────────────────────

  initialize = async () => {
    await BLEService.initializeBLE();
    await BLEService.requestBluetoothPermission();
  };

  /**
   * Scan for nearby faculty sessions.
   *
   * @param {(sessions: SessionInfo[]) => void} onSessionsUpdated
   * @returns {Promise<SessionInfo[]>}
   *
   * @typedef {{ deviceId, localName, subject, branch, semester, rssi, isNearby }} SessionInfo
   *   isNearby — true if RSSI is above the proximity threshold
   */
  scanForSessions = onSessionsUpdated =>
    new Promise(resolve => {
      const discovered = new Map();

      BLEService.scanDevices(
        device => {
          // ─── 1. Filter by Service UUID ───
          const advertisedServices = device.serviceUUIDs ?? [];
          const hasAMService = advertisedServices.some(
            uuid => uuid.toLowerCase() === AM_SERVICE_UUID.toLowerCase(),
          );

          if (!hasAMService) {
            return;
          }

          // ─── 2. Update existing entries (RSSI/Proximity) ───
          if (discovered.has(device.id)) {
            const existing = discovered.get(device.id);
            existing.rssi = device.rssi;
            existing.isNearby = isDeviceCloseEnough(device.rssi);
            discovered.set(device.id, existing);
            onSessionsUpdated(Array.from(discovered.values()));
            return;
          }

          // ─── 3. Parse Metadata (The "ShareIt" Hidden Path) ───
          // We look for info in Service Data instead of the Device Name.
          // serviceData is a map { [uuid]: base64Value }
          const sessionInfo = this._parseSessionInfo(device);
          if (sessionInfo) {
            discovered.set(device.id, sessionInfo);
            onSessionsUpdated(Array.from(discovered.values()));
          }
        },
        [AM_SERVICE_UUID],
      );

      this._scanTimer = setTimeout(() => {
        BLEService.stopDeviceScan();
        resolve(Array.from(discovered.values()));
      }, SCAN_DURATION_MS);
    });

  stopScan = () => {
    if (this._scanTimer) {
      clearTimeout(this._scanTimer);
      this._scanTimer = null;
    }
    BLEService.stopDeviceScan();
  };

  /**
   * Join a faculty session (OTP only).
   *
   * @param {string} deviceId     Faculty device ID from scan
   * @param {string} rollNumber   The student's roll number
   * @param {object} callbacks
   */
  joinSession = async (deviceId, rollNumber, callbacks) => {
    const { onJoinSent, onDisconnected, onError } = callbacks;

    try {
      console.log(TAG, `Connecting to ${deviceId}…`);
      await BLEService.connectToDevice(deviceId, 10000);
      console.log(TAG, 'Connected');

      await BLEService.discoverAllServicesAndCharacteristics();
      console.log(TAG, 'Services discovered');

      // Subscribe to faculty → student notifications
      BLEService.setupMonitor(
        AM_SERVICE_UUID,
        FACULTY_TO_STUDENT_CHAR_UUID,
        message => this._handleFacultyMessage(message, callbacks),
        err => {
          console.error(TAG, 'Monitor error:', err.message);
          onError?.(err);
        },
        'am-faculty-monitor',
      );

      this._disconnectSub = BLEService.onDeviceDisconnected(err => {
        BLEService.finishMonitor();
        onDisconnected?.(err);
      });

      // Build and send JOIN (Sends Roll Number)
      const joinMessage = buildJoinMessage(rollNumber);
      await BLEService.writeCharacteristicWithoutResponse(
        AM_SERVICE_UUID,
        STUDENT_TO_FACULTY_CHAR_UUID,
        joinMessage,
      );
      console.log(TAG, 'Sent:', joinMessage);
      onJoinSent?.();
    } catch (err) {
      console.error(TAG, 'joinSession error:', err.message);
      onError?.(err);
    }
  };

  /**
   * Submit the student's OTP entry.
   * @param {string} code     4-digit OTP
   * @param {Function} onError
   */
  submitOTP = async (code, onError) => {
    try {
      const message = `${MSG.OTP_VERIFY_PREFIX}${code}`;
      await BLEService.writeCharacteristicWithoutResponse(
        AM_SERVICE_UUID,
        STUDENT_TO_FACULTY_CHAR_UUID,
        message,
      );
      console.log(TAG, 'Sent:', message);
    } catch (err) {
      console.error(TAG, 'submitOTP error:', err.message);
      onError?.(err);
    }
  };

  destroy = async () => {
    this.stopScan();
    BLEService.finishMonitor();
    this._disconnectSub?.remove();
    await BLEService.destroy();
  };

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Extract session metadata (Subject|Branch|Sem) from BLE Service Data.
   * This ensures the Faculty phone name remains private in system settings.
   */
  _parseSessionInfo = device => {
    try {
      // Find session data matching our Service UUID
      const rawBase64 = device.serviceData?.[AM_SERVICE_UUID];
      if (!rawBase64) {
        // Fallback to name if service data is missing (for dev/testing)
        const name = device.localName ?? device.name ?? '';
        if (!name.startsWith('AM|')) {
          return null;
        }

        const parts = name.split('|');
        return {
          deviceId: device.id,
          localName: name,
          subject: parts[1] ?? 'Unknown Subject',
          branch: parts[2] ?? 'Unknown Branch',
          semester: parts[3]?.replace('S', '') ?? '?',
          rssi: device.rssi,
          isNearby: isDeviceCloseEnough(device.rssi),
        };
      }

      const decodedString = Buffer.from(rawBase64, 'base64').toString('utf8');
      const parts = decodedString.split('|');

      return {
        deviceId: device.id,
        localName: device.localName ?? device.name ?? 'Faculty Device',
        subject: parts[0] ?? 'Unknown Subject',
        branch: parts[1] ?? 'Unknown Branch',
        semester: parts[2]?.replace('S', '') ?? '?',
        rssi: device.rssi,
        isNearby: isDeviceCloseEnough(device.rssi),
      };
    } catch (err) {
      console.warn(TAG, 'Failed to parse session info:', err);
      return null;
    }
  };

  /**
   * Handle all incoming faculty messages.
   * Also handles JOIN_REJECTED which is new in the security-hardened version.
   */
  _handleFacultyMessage = (message, callbacks) => {
    const {
      onOTPRequested,
      onOTPReceived,
      onOTPWrong,
      onAttendanceConfirmed,
      onRejected,
    } = callbacks;

    console.log(TAG, 'Faculty message:', message);

    // ── JOIN_REJECTED — decode reason and surface to UI ───────────────────
    if (message.startsWith(MSG.JOIN_REJECTED)) {
      const reasonCode = message.slice(MSG.JOIN_REJECTED.length).trim();
      const humanMessage = friendlyRejectionMessage(reasonCode);
      console.warn(TAG, `JOIN rejected: ${reasonCode} — "${humanMessage}"`);
      BLEService.finishMonitor();
      this._disconnectSub?.remove();
      BLEService.disconnectDevice().catch(() => {});
      onRejected?.(humanMessage);
      return;
    }

    if (message === MSG.OTP_REQUEST) {
      onOTPRequested?.();
      return;
    }

    if (message.startsWith(MSG.OTP_PREFIX)) {
      const otp = message.slice(MSG.OTP_PREFIX.length).trim();
      onOTPReceived?.(otp);
      return;
    }

    if (message === MSG.OTP_WRONG) {
      onOTPWrong?.();
      return;
    }

    if (message === MSG.ATTENDANCE_CONFIRMED) {
      BLEService.finishMonitor();
      this._disconnectSub?.remove();
      BLEService.disconnectDevice().catch(() => {});
      onAttendanceConfirmed?.();
      return;
    }

    console.warn(TAG, 'Unknown faculty message:', message);
  };
}

const StudentBLEModule = new StudentBLEModuleClass();
export default StudentBLEModule;
