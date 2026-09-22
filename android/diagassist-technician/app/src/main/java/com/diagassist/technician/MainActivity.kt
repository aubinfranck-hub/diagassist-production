package com.diagassist.technician

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class MainActivity : ComponentActivity() {
    private val requestProjectionCode = 9001
    private var launchUri: Uri? = null
    private var projectionResult = 0
    private var projectionData: Intent? = null

    private val qrLauncher = registerForActivityResult(ScanContract()) { result ->
        val raw = result.contents
        if (raw.isNullOrBlank()) {
            Toast.makeText(this, "Scan annulé.", Toast.LENGTH_SHORT).show()
            showScannerScreen()
            return@registerForActivityResult
        }

        try {
            val uri = Uri.parse(raw)
            if (uri.scheme != "diagassist" || uri.host != "technician") {
                throw IllegalArgumentException("QR DiagAssist non reconnu.")
            }
            if (uri.getQueryParameter("sessionId").isNullOrBlank() ||
                uri.getQueryParameter("pairingCode").isNullOrBlank()
            ) {
                throw IllegalArgumentException("QR d’appairage incomplet.")
            }
            launchUri = uri
            requestProjection()
        } catch (e: Exception) {
            Toast.makeText(this, e.message ?: "QR invalide.", Toast.LENGTH_LONG).show()
            showScannerScreen()
        }
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val incoming = intent?.data
        if (incoming?.scheme == "diagassist" && incoming.host == "technician") {
            launchUri = incoming
            requestProjection()
        } else {
            showScannerScreen()
        }
    }

    private fun showScannerScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.WHITE)
        }

        val title = TextView(this).apply {
            text = "DiagAssist Technician"
            textSize = 26f
            setTextColor(Color.rgb(20, 30, 45))
            gravity = Gravity.CENTER
        }

        val info = TextView(this).apply {
            text = "Cette tablette est le module qui utilise le scanner OBD.\n\n1. Le téléphone DiagAssist affiche un QR.\n2. Scannez le QR ici.\n3. Autorisez ensuite la capture d’écran.\n4. Activez le contrôle DiagAssist dans Accessibilité si demandé."
            textSize = 16f
            setTextColor(Color.DKGRAY)
            gravity = Gravity.CENTER
            setPadding(0, 32, 0, 32)
        }

        val scan = Button(this).apply {
            text = "SCANNER LE QR DIAGASSIST"
            setOnClickListener { launchQrScanner() }
        }

        root.addView(title, LinearLayout.LayoutParams(-1, -2))
        root.addView(info, LinearLayout.LayoutParams(-1, -2))
        root.addView(scan, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)

        // Parcours normal : la tablette ouvre directement le scanner QR.
        window.decorView.postDelayed({ launchQrScanner() }, 350)
    }

    private fun launchQrScanner() {
        val options = ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Cadrez le QR DiagAssist affiché sur le téléphone")
            .setBeepEnabled(true)
            .setTorchEnabled(false)
            .setOrientationLocked(false)
        qrLauncher.launch(options)
    }

    private fun requestProjection() {
        val uri = launchUri ?: run {
            showScannerScreen()
            return
        }
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        Toast.makeText(this, "QR reconnu. Autorisez maintenant le partage de l’écran.", Toast.LENGTH_LONG).show()
        startActivityForResult(manager.createScreenCaptureIntent(), requestProjectionCode)
    }

    @Deprecated("Android activity result compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != requestProjectionCode) return
        if (resultCode != Activity.RESULT_OK || data == null) {
            Toast.makeText(this, "La capture d’écran est nécessaire pour connecter la tablette.", Toast.LENGTH_LONG).show()
            showScannerScreen()
            return
        }

        projectionResult = resultCode
        projectionData = data
        startAgent()
    }

    private fun startAgent() {
        val u = launchUri ?: return
        val token = u.getQueryParameter("token") ?: ""
        val session = u.getQueryParameter("sessionId") ?: ""
        val pairing = u.getQueryParameter("pairingCode") ?: ""
        val ws = u.getQueryParameter("wsUrl") ?: "https://diagassist-production.onrender.com"

        startForegroundService(Intent(this, ScreenCaptureService::class.java).apply {
            putExtra("resultCode", projectionResult)
            putExtra("resultData", projectionData)
            putExtra("token", token)
            putExtra("sessionId", session)
            putExtra("pairingCode", pairing)
            putExtra("wsUrl", ws)
        })

        Toast.makeText(this, "Tablette appairée. DiagAssist va recevoir son écran.", Toast.LENGTH_LONG).show()

        if (!isAccessibilityEnabled()) {
            Toast.makeText(this, "Activez « DiagAssist Remote Control » dans Accessibilité pour permettre les clics, retours et défilements.", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        finish()
    }

    private fun isAccessibilityEnabled(): Boolean {
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        val expected = ComponentName(this, RemoteAccessibilityService::class.java).flattenToString()
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }
}
