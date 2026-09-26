# DiagAssist V2 — Technician Agent

Agent Android natif destiné à la tablette du technicien.

Le premier lancement demande l'autorisation système MediaProjection. Les connexions suivantes peuvent réutiliser l'agent installé. Le déploiement totalement silencieux nécessite une tablette administrée par MDM/Android Enterprise.

Le serveur reste responsable de l'authentification, du Premium et de l'appairage.

## Distribution

Le workflow `build-technician-release.yml` publie automatiquement l'APK signé sur
`public/downloads/diagassist-scanner.apk` à chaque build réussi, ce qui le rend
téléchargeable directement depuis le site (`https://www.diagassist.app/downloads/diagassist-scanner.apk`),
sans passer par les artefacts GitHub Actions. Le panneau "Scanner & coaching" de
l'app web pointe vers ce lien.