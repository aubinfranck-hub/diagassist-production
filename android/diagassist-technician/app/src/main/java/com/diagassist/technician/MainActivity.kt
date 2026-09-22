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
            setPadding(40, 48, 40, 40)
            setBackgroundColor(Color.rgb(15, 23, 42))
        }

        val logo = android.widget.ImageView(this).apply {
            setImageResource(com.diagassist.technician.R.drawable.ic_diagassist_scanner)
            contentDescription = "Logo DiagAssist Scanner"
            layoutParams = LinearLayout.LayoutParams(132, 132).apply { bottomMargin = 24 }
        }

        val title = TextView(this).apply {
            text = "DiagAssist Scanner"
            textSize = 28f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }

        val subtitle = TextView(this).apply {
            text = getString(com.diagassist.technician.R.string.scanner_subtitle)
            textSize = 14f
            setTextColor(Color.rgb(148, 163, 184))
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 28)
        }

        val info = TextView(this).apply {
            text = listOf(
                getString(com.diagassist.technician.R.string.scanner_step_1),
                getString(com.diagassist.technician.R.string.scanner_step_2),
                getString(com.diagassist.technician.R.string.scanner_step_3),
                getString(com.diagassist.technician.R.string.scanner_step_4)
            ).joinToString("\n\n")
            textSize = 15f
            setTextColor(Color.rgb(226, 232, 240))
            gravity = Gravity.START
            setPadding(8, 20, 8, 28)
        }

        val scan = Button(this).apply {
            text = getString(com.diagassist.technician.R.string.scan_button)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(220, 38, 38))
            setOnClickListener { launchQrScanner() }
        }

        root.addView(logo)
        root.addView(title, LinearLayout.LayoutParams(-1, -2))
        root.addView(subtitle, LinearLayout.LayoutParams(-1, -2))
        root.addView(info, LinearLayout.LayoutParams(-1, -2))
        root.addView(scan, LinearLayout.LayoutParams(-1, 56).apply {
            topMargin = 8
        })
        setContentView(root)

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
            Toast.makeText(this, "Activez « DiagAssist Scanner — Contrôle » dans Accessibilité pour permettre les clics, retours et défilements.", Toast.LENGTH_LONG).show()
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
