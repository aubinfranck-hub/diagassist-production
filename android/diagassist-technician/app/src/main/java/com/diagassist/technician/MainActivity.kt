package com.diagassist.technician

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private val requestProjectionCode = 9001
    private var launchUri: Uri? = null
    private var projectionResult = 0
    private var projectionData: Intent? = null
    private var waitingForProjection = false
    private val httpClient = OkHttpClient()

    private val qrLauncher = registerForActivityResult(ScanContract()) { result ->
        val raw = result.contents
        if (raw.isNullOrBlank()) {
            Toast.makeText(this, "Scan annulé. Choisissez QR ou Code pour recommencer.", Toast.LENGTH_SHORT).show()
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
        if (state != null) {
            launchUri = state.getString("launchUri")?.let { runCatching { Uri.parse(it) }.getOrNull() }
            waitingForProjection = state.getBoolean("waitingForProjection", false)
        }
        val incoming = intent?.data
        if (incoming?.scheme == "diagassist" && incoming.host == "technician") {
            launchUri = incoming
            requestProjection()
        } else if (launchUri != null && waitingForProjection) {
            // Android may recreate this Activity while the system projection picker is open.
        } else {
            showScannerScreen()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("launchUri", launchUri?.toString())
        outState.putBoolean("waitingForProjection", waitingForProjection)
        super.onSaveInstanceState(outState)
    }

    private fun showScannerScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(40, 40, 40, 36)
            setBackgroundColor(Color.rgb(15, 23, 42))
        }

        val logo = ImageView(this).apply {
            setImageResource(R.drawable.ic_diagassist_scanner)
            contentDescription = "Logo DiagAssist Scanner"
            layoutParams = LinearLayout.LayoutParams(124, 124).apply { bottomMargin = 18 }
        }

        val title = TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 28f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }

        val subtitle = TextView(this).apply {
            text = getString(R.string.scanner_subtitle)
            textSize = 14f
            setTextColor(Color.rgb(148, 163, 184))
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 20)
        }

        val info = TextView(this).apply {
            text = getString(R.string.scanner_connection_help)
            textSize = 15f
            setTextColor(Color.rgb(226, 232, 240))
            gravity = Gravity.CENTER
            setPadding(8, 8, 8, 20)
        }

        val scan = Button(this).apply {
            text = getString(R.string.scan_button)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(220, 38, 38))
            setOnClickListener { launchQrScanner() }
        }

        val codeButton = Button(this).apply {
            text = getString(R.string.code_button)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(30, 64, 175))
            setOnClickListener { showCodeDialog() }
        }

        val footer = TextView(this).apply {
            text = getString(R.string.scanner_footer)
            textSize = 12f
            setTextColor(Color.rgb(148, 163, 184))
            gravity = Gravity.CENTER
            setPadding(0, 18, 0, 0)
        }

        root.addView(logo)
        root.addView(title, LinearLayout.LayoutParams(-1, -2))
        root.addView(subtitle, LinearLayout.LayoutParams(-1, -2))
        root.addView(info, LinearLayout.LayoutParams(-1, -2))
        root.addView(scan, LinearLayout.LayoutParams(-1, 56).apply { topMargin = 4 })
        root.addView(codeButton, LinearLayout.LayoutParams(-1, 56).apply { topMargin = 10 })
        root.addView(footer, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)

        // Important: do NOT relaunch the scanner automatically. The previous auto-launch
        // caused a loop when Android closed the scanner activity or when pairing was cancelled.
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

    private fun showCodeDialog() {
        val input = EditText(this).apply {
            hint = getString(R.string.code_hint)
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
            textSize = 22f
            gravity = Gravity.CENTER
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 8, 40, 0)
            addView(input, LinearLayout.LayoutParams(-1, 64))
        }

        android.app.AlertDialog.Builder(this)
            .setTitle(getString(R.string.code_title))
            .setMessage(getString(R.string.code_message))
            .setView(container)
            .setNegativeButton("Annuler", null)
            .setPositiveButton("VALIDER", null)
            .create()
            .also { dialog ->
                dialog.setOnShowListener {
                    dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val code = input.text.toString().trim()
                        if (!code.matches(Regex("\\d{6}"))) {
                            input.error = "Entrez le code à 6 chiffres"
                            return@setOnClickListener
                        }
                        dialog.dismiss()
                        pairByCode(code)
                    }
                }
                dialog.show()
            }
    }

    private fun pairByCode(code: String) {
        Toast.makeText(this, "Vérification du code…", Toast.LENGTH_SHORT).show()

        Thread {
            try {
                val body = JSONObject().put("pairingCode", code).toString()
                    .toRequestBody("application/json; charset=utf-8".toMediaType())
                val request = Request.Builder()
                    .url("https://diagassist-production.onrender.com/api/screening/pair-by-code")
                    .post(body)
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    val text = response.body?.string().orEmpty()
                    val json = if (text.isNotBlank()) JSONObject(text) else JSONObject()
                    if (!response.isSuccessful || !json.optBoolean("success", false)) {
                        val message = json.optString("message", "Code invalide ou expiré.")
                        runOnUiThread {
                            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                        }
                        return@use
                    }

                    val session = json.optString("sessionId")
                    val pairing = json.optString("pairingCode")
                    val ws = json.optString("wsUrl", "https://diagassist-production.onrender.com")
                    if (session.isBlank() || pairing.isBlank()) {
                        runOnUiThread {
                            Toast.makeText(this, "Réponse de connexion incomplète.", Toast.LENGTH_LONG).show()
                        }
                        return@use
                    }

                    launchUri = Uri.parse("diagassist://technician")
                        .buildUpon()
                        .appendQueryParameter("sessionId", session)
                        .appendQueryParameter("pairingCode", pairing)
                        .appendQueryParameter("wsUrl", ws)
                        .build()

                    runOnUiThread { requestProjection() }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this, "Connexion impossible. Vérifiez Internet et réessayez.", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun requestProjection() {
        val uri = launchUri ?: run {
            showScannerScreen()
            return
        }
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        waitingForProjection = true
        Toast.makeText(this, "QR validé. À l’écran suivant, choisissez l’application de diagnostic à diffuser.", Toast.LENGTH_LONG).show()
        // Android 14+ : demander explicitement à Android le choix de la fenêtre/application.
        // Sur certains appareils Xiaomi/HyperOS, le choix explicite est plus fiable.
        if (Build.VERSION.SDK_INT >= 34) {
            val config = android.media.projection.MediaProjectionConfig.createConfigForUserChoice()
            startActivityForResult(manager.createScreenCaptureIntent(config), requestProjectionCode)
        } else {
            startActivityForResult(manager.createScreenCaptureIntent(), requestProjectionCode)
        }
    }

    @Deprecated("Android activity result compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != requestProjectionCode) return
        waitingForProjection = false
        if (resultCode != Activity.RESULT_OK || data == null) {
            Toast.makeText(this, "Partage annulé. Utilisez les boutons QR ou CODE pour recommencer.", Toast.LENGTH_LONG).show()
            showScannerScreen()
            return
        }

        projectionResult = resultCode
        projectionData = data
        startAgent()
    }

    private fun startAgent() {
        val u = launchUri ?: return
        val session = u.getQueryParameter("sessionId") ?: ""
        val pairing = u.getQueryParameter("pairingCode") ?: ""
        val ws = u.getQueryParameter("wsUrl") ?: "https://diagassist-production.onrender.com"

        startForegroundService(Intent(this, ScreenCaptureService::class.java).apply {
            putExtra("resultCode", projectionResult)
            putExtra("resultData", projectionData)
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
