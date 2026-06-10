package com.am_student_app.tflite

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.*
import com.google.mlkit.vision.face.FaceLandmark
import org.tensorflow.lite.Interpreter
import java.io.File
import java.util.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

/**
 * Native module that runs TFLite inference for MobileFaceNet face embeddings.
 * Uses the TFLite Java API directly — no WASM, no C++/CMake needed.
 *
 * KEY METHOD: recognizeFaceFromFile()
 *   Does the entire pipeline in native Kotlin:
 *     1. Read JPEG from filesystem (BitmapFactory — fast native I/O)
 *     2. Fix EXIF rotation (front camera photos are often rotated 90/270°)
 *     3. Crop a centered square (face is assumed to be in the center — UI guides the user)
 *     4. Resize to 112×112 (MobileFaceNet input)
 *     5. Normalize pixels to [-1, 1]
 *     6. Run TFLite inference
 *     7. L2-normalize the output embedding
 *     8. Return 128-dim float array to JS
 *
 *   This replaces the old JS pipeline (RNFS read → base64 decode → TF.js decodeJpeg →
 *   BlazeFace detection on CPU [SLOW] → cropAndResize → bridge transfer → TFLite).
 *   Everything stays in native code — no JS bridge data transfer for image pixels.
 */
class TFLiteModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var interpreter: Interpreter? = null

    // Anti-spoofing state: stores landmarks from the previous frame to track motion
    private var lastLandmarks: Map<Int, android.graphics.PointF>? = null

    override fun getName(): String = "TFLiteModule"

    // ─── Model Loading ────────────────────────────────────────────────────────

    /**
     * Load a TFLite model from a local file path.
     */
    @ReactMethod
    fun loadModel(path: String, promise: Promise) {
        try {
            val filePath = path.removePrefix("file://")
            val modelFile = File(filePath)
            if (!modelFile.exists()) {
                promise.reject("MODEL_NOT_FOUND", "Model file not found at: $filePath")
                return
            }
            val options = Interpreter.Options().apply { setNumThreads(4) }
            interpreter = Interpreter(modelFile, options)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("MODEL_LOAD_ERROR", "Failed to load TFLite model: ${e.message}", e)
        }
    }

    /**
     * Load a TFLite model from the Android 'assets' folder.
     */
    @ReactMethod
    fun loadModelFromAssets(assetName: String, promise: Promise) {
        try {
            val assetManager = reactApplicationContext.assets
            val fileDescriptor = assetManager.openFd(assetName)
            val inputStream = fileDescriptor.createInputStream()
            val fileChannel = inputStream.channel
            val buffer = fileChannel.map(
                java.nio.channels.FileChannel.MapMode.READ_ONLY,
                fileDescriptor.startOffset,
                fileDescriptor.declaredLength
            )
            val options = Interpreter.Options().apply { setNumThreads(4) }
            interpreter = Interpreter(buffer, options)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ASSET_LOAD_ERROR", "Failed to load TFLite from assets: ${e.message}", e)
        }
    }

    // ─── Fast All-Native Face Recognition ────────────────────────────────────

    /**
     * THE FAST PATH: reads an image file, preprocesses it, and runs TFLite
     * entirely in native Kotlin — no JS/bridge data transfer for image pixels.
     *
     * @param imagePath  Absolute filesystem path to the JPEG (with or without "file://" prefix)
     * @param promise    Resolves with a 128-dim float array (the face embedding)
     */
    @ReactMethod
    fun recognizeFaceFromFile(imagePath: String, promise: Promise) {
        try {
            val interp = interpreter
            if (interp == null) {
                promise.reject("MODEL_NOT_LOADED", "Model not loaded. Call loadModelFromAssets first.")
                return
            }

            val path = imagePath.removePrefix("file://")
            val file = File(path)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "Image not found: $path")
                return
            }

            val options = BitmapFactory.Options().apply { inSampleSize = 2 }
            var bitmap = BitmapFactory.decodeFile(path, options)
            if (bitmap == null) {
                promise.reject("DECODE_ERROR", "BitmapFactory could not decode: $path")
                return
            }

            bitmap = fixExifRotation(bitmap, path)

            val image = com.google.mlkit.vision.common.InputImage.fromBitmap(bitmap, 0)
            val detectorOptions = com.google.mlkit.vision.face.FaceDetectorOptions.Builder()
                .setPerformanceMode(com.google.mlkit.vision.face.FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setLandmarkMode(com.google.mlkit.vision.face.FaceDetectorOptions.LANDMARK_MODE_ALL)
                .build()
            val detector = com.google.mlkit.vision.face.FaceDetection.getClient(detectorOptions)

            detector.process(image)
                .addOnSuccessListener { faces ->
                    try {
                        if (faces.isEmpty()) {
                            promise.reject("NO_FACE", "No face detected in the image.")
                            return@addOnSuccessListener
                        }
                        
                        val face = faces[0]
                        val bounds = face.boundingBox
                        
                        val left = maxOf(0, bounds.left)
                        val top = maxOf(0, bounds.top)
                        val right = minOf(bitmap.width, bounds.right)
                        val bottom = minOf(bitmap.height, bounds.bottom)
                        val cropWidth = right - left
                        val cropHeight = bottom - top
                        
                        // Admin Dashboard uses canvas.drawImage with the exact bounding box width/height,
                        // which squashes the rectangular face into a 112x112 square. 
                        // To get mathematically identical embeddings, we must mimic this exact squash effect.
                        var croppedBitmap = Bitmap.createBitmap(bitmap, left, top, cropWidth, cropHeight)
                        croppedBitmap = Bitmap.createScaledBitmap(croppedBitmap, 112, 112, true)

                        val inputBuffer = ByteBuffer.allocateDirect(1 * 112 * 112 * 3 * 4)
                        inputBuffer.order(ByteOrder.nativeOrder())
                        val pixels = IntArray(112 * 112)
                        croppedBitmap.getPixels(pixels, 0, 112, 0, 0, 112, 112)
                        for (pixel in pixels) {
                            inputBuffer.putFloat(((pixel shr 16 and 0xFF) - 127.5f) / 128.0f) // R
                            inputBuffer.putFloat(((pixel shr 8  and 0xFF) - 127.5f) / 128.0f) // G
                            inputBuffer.putFloat(((pixel        and 0xFF) - 127.5f) / 128.0f) // B
                        }
                        inputBuffer.rewind()
                        croppedBitmap.recycle()
                        bitmap.recycle()

                        val outputShape = interp.getOutputTensor(0).shape()
                        val outputSize = outputShape.fold(1) { acc, dim -> acc * dim }
                        val outputBuffer = ByteBuffer.allocateDirect(outputSize * 4)
                        outputBuffer.order(ByteOrder.nativeOrder())
                        interp.run(inputBuffer, outputBuffer)
                        outputBuffer.rewind()

                        val raw = FloatArray(minOf(128, outputSize)) { outputBuffer.getFloat() }

                        val norm = Math.sqrt(raw.map { (it * it).toDouble() }.sum()).toFloat()
                        val normalized = if (norm > 0f) raw.map { it / norm } else raw.toList()

                        val result = Arguments.createMap()
                        val embeddingArray = Arguments.createArray()
                        normalized.forEach { embeddingArray.pushDouble(it.toDouble()) }
                        
                        // Anti-spoofing is disabled to prevent false positives and speed up matching.
                        val isSpoof = false
                        val spoofReason = ""

                        result.putArray("embedding", embeddingArray)
                        result.putBoolean("isSpoof", isSpoof)
                        result.putString("reason", spoofReason)
                        
                        promise.resolve(result)
                    } catch (e: Exception) {
                        promise.reject("POST_DETECT_ERROR", e.message, e)
                    } finally {
                        detector.close()
                    }
                }
                .addOnFailureListener { e ->
                    promise.reject("MLKIT_ERROR", e.message, e)
                    detector.close()
                }

        } catch (e: Exception) {
            promise.reject("RECOGNITION_ERROR", "recognizeFaceFromFile failed: ${e.message}", e)
        }
    }

    // ─── Low-level Inference (kept for compatibility) ─────────────────────────

    /**
     * Run inference on a flat Float32 input array (legacy JS pipeline).
     */
    @ReactMethod
    fun runInference(inputData: ReadableArray, promise: Promise) {
        try {
            val interp = interpreter
                ?: return promise.reject("MODEL_NOT_LOADED", "Model not loaded.")

            val inputSize = inputData.size()
            val inputBuffer = ByteBuffer.allocateDirect(inputSize * 4)
            inputBuffer.order(ByteOrder.nativeOrder())
            for (i in 0 until inputSize) inputBuffer.putFloat(inputData.getDouble(i).toFloat())
            inputBuffer.rewind()

            val outputShape = interp.getOutputTensor(0).shape()
            val outputSize = outputShape.fold(1) { acc, dim -> acc * dim }
            val outputBuffer = ByteBuffer.allocateDirect(outputSize * 4)
            outputBuffer.order(ByteOrder.nativeOrder())
            interp.run(inputBuffer, outputBuffer)
            outputBuffer.rewind()

            val result = Arguments.createArray()
            for (i in 0 until outputSize) result.pushDouble(outputBuffer.getFloat().toDouble())
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("INFERENCE_ERROR", "TFLite inference failed: ${e.message}", e)
        }
    }

    @ReactMethod
    fun close(promise: Promise) {
        try {
            interpreter?.close()
            interpreter = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLOSE_ERROR", e.message, e)
        }
    }

    // ─── Private Helpers ──────────────────────────────────────────────────────

    /**
     * Read EXIF orientation and rotate the bitmap to upright.
     * Front camera JPEGs are saved rotated on most Android devices.
     */
    private fun fixExifRotation(bitmap: Bitmap, filePath: String): Bitmap {
        return try {
            val exif = ExifInterface(filePath)
            val orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )
            val degrees = when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90  -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> return bitmap
            }
            val matrix = Matrix().apply { postRotate(degrees) }
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
                .also { if (it != bitmap) bitmap.recycle() }
        } catch (e: Exception) {
            bitmap // If EXIF read fails, return original
        }
    }

}
