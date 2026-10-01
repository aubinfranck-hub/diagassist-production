package com.diagassist.technician

import android.net.Uri

/**
 * Le lien d'appairage (QR ou diagassist://technician?...) peut être ouvert par n'importe quelle page
 * web ou application : son paramètre wsUrl ne doit donc jamais décider vers quel serveur l'écran de la
 * tablette est envoyé. Seuls les domaines DiagAssist, en https, sont acceptés ; sinon le serveur de
 * production par défaut est utilisé.
 */
object TrustedServer {
    const val DEFAULT = "https://diagassist-production.onrender.com"

    private val TRUSTED_HOSTS = setOf(
        "diagassist-production.onrender.com",
        "diagassist.app",
        "www.diagassist.app",
    )

    fun resolve(raw: String?): String {
        if (raw.isNullOrBlank()) return DEFAULT
        val uri = runCatching { Uri.parse(raw.trim()) }.getOrNull() ?: return DEFAULT
        val host = uri.host?.lowercase() ?: return DEFAULT
        val portOk = uri.port == -1 || uri.port == 443
        return if (uri.scheme == "https" && host in TRUSTED_HOSTS && portOk && uri.userInfo == null) {
            "https://$host"
        } else {
            DEFAULT
        }
    }
}
