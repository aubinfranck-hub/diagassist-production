package com.diagassist.technician

import android.app.*
import android.content.pm.ServiceInfo
import android.content.*
import android.graphics.*
import android.hardware.display.DisplayManager
import android.media.Image
import android.media.ImageReader
import android.os.*
import android.provider.Settings
import android.util.Base64
import android.widget.Toast
import androidx.core.app.NotificationCompat
import okhttp3.*
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class ScreenCaptureService : Service() {
    private var reader: ImageReader? = null
    private var display: android.hardware.display.VirtualDisplay? = null
    private var socket: WebSocket? = null
    private var projection: android.media.projection.MediaProjection? = null
    private val executor = Executors.newSingleThreadExecutor()
    private var sequence = 0
    private var previousHash: String? = null
    private var forceNextFrame = false
    private var wsBase = ""
    private var authToken = ""
    private var currentSession = ""
    private var pairingCode = ""
    private var deviceId = ""
    private var reconnecting = false
    private var everPaired = false
    private var stopped = false
    private var preParingAttempts = 0
    private val httpClient = OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).build()
    private var projectionCallback: android.media.projection.MediaProjection.Callback? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate() {
        super.onCreate()
        ScreenCaptureServiceBridge.register { action, success -> sendCommandResult(action, success) }
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel("diagassist", "DiagAssist V2", NotificationManager.IMPORTANCE_LOW)
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification("Capture écran active")
        if (Build.VERSION.SDK_INT >= 29) startForeground(1001, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(1001, notification)
        val code = intent?.getIntExtra("resultCode", 0) ?: return START_NOT_STICKY
        val data = intent.getParcelableExtra<Intent>("resultData") ?: return START_NOT_STICKY
        wsBase = intent.getStringExtra("wsUrl") ?: "https://diagassist-production.onrender.com"
        currentSession = intent.getStringExtra("sessionId") ?: ""
        pairingCode = intent.getStringExtra("pairingCode") ?: ""
        authToken = intent.getStringExtra("token") ?: ""
        deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown-device"

        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
        projection = manager.getMediaProjection(code, data)
        connect()
        return START_STICKY
    }

    private fun connect() {
        if (currentSession.isBlank() || pairingCode.isBlank()) return
        val schemeBase = wsBase.trimEnd('/').replaceFirst("^https://".toRegex(), "wss://").replaceFirst("^http://".toRegex(), "ws://")
        val url = schemeBase + "/api/screening/stream"
        if (stopped) return
        socket?.cancel()
        socket = httpClient.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    reconnecting = false
                    ws.send(JSONObject(mapOf(
                        "type" to "pairing",
                        "sessionId" to currentSession,
                        "pairingCode" to pairingCode,
                        "deviceId" to deviceId,
                        "reconnect" to everPaired
                    )).toString())
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    try {
                        val m = JSONObject(text)
                        if (m.optString("type") == "error") {
                            stopCaptureAndExit(m.optString("message", "Appairage refusé par DiagAssist."))
                            return
                        }
                    } catch (_: Exception) {
                    }
                    handleCommand(text)
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    scheduleReconnect()
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    scheduleReconnect()
                }
            }
        )
    }

    private fun scheduleReconnect() {
        if (stopped || reconnecting) return
        if (!everPaired) {
            preParingAttempts++
            if (preParingAttempts > MAX_PRE_PAIRING_ATTEMPTS) {
                stopCaptureAndExit("Connexion à DiagAssist impossible. Vérifiez la connexion Internet de la tablette et réessayez.")
                return
            }
        }
        reconnecting = true
        mainHandler.postDelayed({
            if (stopped) return@postDelayed
            reconnecting = false
            connect()
        }, 3000)
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, "diagassist")
            .setContentTitle("DiagAssist Scanner")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()
    }

    private fun startCapture() {
        if (reader != null || projection == null) return

        val metrics = if (Build.VERSION.SDK_INT >= 30) {
            (getSystemService(WINDOW_SERVICE) as android.view.WindowManager).maximumWindowMetrics
        } else {
            null
        }
        val w = metrics?.bounds?.width() ?: resources.displayMetrics.widthPixels
        val h = metrics?.bounds?.height() ?: resources.displayMetrics.heightPixels
        val density = resources.displayMetrics.densityDpi

        createCaptureSurface(w, h)

        val p = projection ?: return
        projectionCallback = object : android.media.projection.MediaProjection.Callback() {
            override fun onCapturedContentResize(width: Int, height: Int) {
                if (width > 0 && height > 0) {
                    mainHandler.post { resizeCapture(width, height, density) }
                }
            }

            override fun onCapturedContentVisibilityChanged(isVisible: Boolean) {
                // Required lifecycle callback for Android 14+ app-window capture.
            }

            override fun onStop() {
                mainHandler.post { stopCaptureResources() }
            }
        }
        p.registerCallback(projectionCallback!!, mainHandler)

        display = p.createVirtualDisplay(
            "DiagAssist",
            w,
            h,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader!!.surface,
            null,
            mainHandler
        )
    }

    private fun createCaptureSurface(w: Int, h: Int) {
        reader?.close()
        reader = ImageReader.newInstance(w, h, android.graphics.PixelFormat.RGBA_8888, 2)
        reader!!.setOnImageAvailableListener({ r ->
            executor.execute { process(r.acquireLatestImage(), w, h, false) }
        }, mainHandler)
    }

    private fun resizeCapture(w: Int, h: Int, density: Int) {
        val vd = display ?: return
        createCaptureSurface(w, h)
        vd.resize(w, h, density)
        vd.surface = reader?.surface
        forceNextFrame = true
    }


    private fun imageToBitmap(image: Image, width: Int, height: Int): Bitmap? {
        val plane = image.planes.firstOrNull() ?: return null
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width
        val paddedWidth = width + (rowPadding / pixelStride)

        val raw = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
        val buffer = plane.buffer.duplicate()
        buffer.rewind()
        raw.copyPixelsFromBuffer(buffer)

        return if (paddedWidth == width) raw
        else Bitmap.createBitmap(raw, 0, 0, width, height).also { raw.recycle() }
    }

    private fun process(image: Image?, w: Int, h: Int, force: Boolean) {
        if (image == null) return
        try {
            val bmp = imageToBitmap(image, w, h) ?: return

            val small = Bitmap.createScaledBitmap(bmp, 32, 32, true)
            val bytes = ByteArray(32 * 32 * 4)
            small.copyPixelsToBuffer(ByteBuffer.wrap(bytes))
            val hash = Base64.encodeToString(
                MessageDigest.getInstance("SHA-256").digest(bytes),
                Base64.NO_WRAP
            )

            if (!force && !forceNextFrame && hash == previousHash) {
                small.recycle()
                bmp.recycle()
                return
            }

            previousHash = hash
            forceNextFrame = false
            small.recycle()

            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, 70, out)
            bmp.recycle()

            val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            sequence++

            socket?.send(
                JSONObject(
                    mapOf(
                        "type" to "frame",
                        "sessionId" to currentSession,
                        "payload" to JSONObject(
                            mapOf(
                                "frameId" to "frame_$sequence",
                                "sequence" to sequence,
                                "imageData" to "data:image/jpeg;base64,$b64",
                                "mimeType" to "image/jpeg",
                                "width" to w,
                                "height" to h
                            )
                        )
                    )
                ).toString()
            )
        } catch (_: Exception) {
        } finally {
            image.close()
        }
    }

    private fun captureCurrentFrame() {
        forceNextFrame = true
        reader?.acquireLatestImage()?.let { image ->
            val metrics = resources.displayMetrics
            process(image, metrics.widthPixels, metrics.heightPixels, true)
        }
    }

    private fun handleCommand(text: String) {
        try {
            val m = JSONObject(text)
            when (m.optString("type")) {
                "pairing" -> {
                    if (m.optBoolean("success", false)) {
                        currentSession = m.optString("sessionId", currentSession)
                        everPaired = true
                        preParingAttempts = 0
                        startCapture()
                    } else {
                        stopCaptureAndExit(m.optString("message", "Appairage refusé par DiagAssist."))
                    }
                }
                "command" -> {
                    val payload = m.optJSONObject("payload") ?: return
                    val action = payload.optString("action")
                    when (action) {
                        "request_screen" -> executor.execute { captureCurrentFrame() }
                        "click", "scroll", "input", "back" -> {
                            RemoteCommandBus.dispatch(action, payload.toString())
                        }
                    }
                }
            }
        } catch (_: Exception) {
        }
    }

    fun sendCommandResult(action: String, success: Boolean, message: String? = null) {
        socket?.send(
            JSONObject(
                mapOf(
                    "type" to "command_result",
                    "sessionId" to currentSession,
                    "payload" to JSONObject(
                        mapOf(
                            "action" to action,
                            "success" to success,
                            "message" to (message ?: "")
                        )
                    )
                )
            ).toString()
        )
    }

    private fun stopCaptureAndExit(message: String) {
        stopped = true
        mainHandler.removeCallbacksAndMessages(null)
        socket?.close(1000, "Appairage refusé")
        mainHandler.post { Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show() }
        stopSelf()
    }

    companion object {
        private const val MAX_PRE_PAIRING_ATTEMPTS = 5
    }

    private fun stopCaptureResources() {
        display?.release()
        display = null
        reader?.close()
        reader = null
    }

    override fun onDestroy() {
        stopped = true
        mainHandler.removeCallbacksAndMessages(null)
        ScreenCaptureServiceBridge.register(null)
        socket?.close(1000, "stop")
        projectionCallback?.let { cb -> runCatching { projection?.unregisterCallback(cb) } }
        stopCaptureResources()
        projection?.stop()
        projection = null
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
