# AM Student App (Academic Monitor)

The **AM Student App** is the student-facing companion to the Academic Monitor ecosystem. It provides a secure, friction-less, and hardware-accelerated way to mark attendance in class using a two-step verification process: **On-Device Facial Recognition** and **Proximity-Based Bluetooth Low Energy (BLE)** handshake.

## 🚀 Key Features

### 1. 🤖 On-Device AI Facial Verification
- **Privacy First:** Facial recognition happens entirely offline on the student's device. No raw images are sent over the internet for verification.
- **TensorFlow Lite:** Utilizes `@tensorflow/tfjs` and a quantized `mobilefacenet.tflite` model to extract 128-dimensional face embeddings in real-time.
- **Liveness & Speed:** Powered by `react-native-vision-camera` for low-latency frame extraction and BlazeFace for rapid face detection.

### 2. 📡 Biometric Proximity Handshake (BLE)
- **Zero-Internet Attendance:** Once verified, the app scans for the Faculty's BLE broadcast using `react-native-ble-plx`. No Wi-Fi or cellular data is needed in the classroom.
- **Secure Handshake:** Uses a hidden "ShareIt" style BLE advertising payload. The student device sends an encrypted JOIN request containing their Roll Number.
- **Distance Filtering:** The app leverages RSSI (Received Signal Strength Indicator) to ensure students are physically *inside* the classroom (e.g., > -70 dBm).
- **OTP Verification:** Faculty can optionally enforce a 4-digit PIN for the session, which the student enters to finalize the BLE handshake.

### 3. ☁️ Supabase Cloud Synchronization
- Student embeddings and identities are securely synced from Supabase upon login.
- New students are registered securely using the Python utility script which computes the baseline embeddings.

---

## 🛠️ Technology Stack

- **Framework:** React Native 0.73.6, Expo 50
- **Machine Learning:** TensorFlow.js (`@tensorflow/tfjs-react-native`), BlazeFace
- **Bluetooth:** `react-native-ble-plx`
- **Camera:** `react-native-vision-camera` (v4)
- **Local Storage:** `react-native-mmkv` (Ultra-fast synchronous storage for embeddings)
- **Backend:** Supabase

---

## 📁 Project Structure

```text
Student_BLE/
├── App.js                     # Root component, orchestrates auth flow
├── register_student.py        # Python script to enroll a new student face & push to Supabase
├── assets/models/             # Contains mobilefacenet.tflite model
├── src/
│   ├── auth/                  # StudentAuthProvider for global auth state
│   ├── ble/                   # BLE Module, Constants, and Handshake Logic
│   ├── facerecg/              # TF.js Pipelines, Face Detectors, Embedding Extractor
│   ├── hooks/                 # useFaceRecognition hook containing the camera loop
│   ├── screens/               # UI Screens (FaceScan, Attendance, Register)
│   └── services/              # Supabase Client, Student sync, and MMKV local storage
└── ...
```

---

## ⚙️ Getting Started

### Prerequisites
- **Node.js:** v18+
- **Python:** 3.8+ (for registration script)
- **Mobile Environment:** Android Studio (SDK 34) or Xcode.

### 1. Installation

```bash
git clone https://github.com/nitishvofficial/Student.git
cd Student_BLE
npm install
```

### 2. Registration (Enrolling a Student)
Before a student can log in, their face must be registered in the system using the provided Python script.
```bash
pip install opencv-python numpy tensorflow urllib3
python register_student.py path/to/photo.jpg <UID> <Name> <RollNo> <Course> <Branch> <Semester> <Section>
```
*This extracts the 128-d embedding from the photo and uploads it to Supabase.*

### 3. Running the App

*Ensure you have configured your `.env` file with `SUPABASE_URL` and `SUPABASE_ANON_KEY`.*

**Android:**
```bash
npm run android
```

**iOS:**
```bash
cd ios && pod install && cd ..
npm run ios
```

---

## 🔒 Security Architecture

1. **Spoofing Prevention:** The camera requires real-time framing. The Face Pipeline matches the LIVE feed against the safely stored baseline embedding (cosine similarity threshold).
2. **Proxy Attendance Prevention:** BLE RSSI gating ensures the device is within a few meters of the Faculty's phone. Remote check-ins are physically impossible.
3. **Session Hijacking Prevention:** The faculty's session is dynamically advertised via BLE Service Data, preventing spoofed access points. OTP acts as an additional layer.

---
*Developed for Academic Monitor (AM) System.*
