// Sécurité fail-closed : si NODE_ENV n'est pas défini, on suppose la PRODUCTION
// (sauf en lançant explicitement `tsx server.ts` / `npm run dev`, ou en test).
// Avant : NODE_ENV absent = mode dev = OTP renvoyé au client + serveur Vite de dev.
// Ce fichier doit rester le PREMIER import de server.ts (les imports ESM s'exécutent dans l'ordre).
if (!process.env.NODE_ENV) {
  const entry = process.argv[1] || "";
  const isDevRun = /server\.ts$/.test(entry) || process.env.npm_lifecycle_event === "dev";
  process.env.NODE_ENV = isDevRun ? "development" : "production";
}
if (process.env.NODE_ENV === "production" && process.env.DEV_MASTER_OTP) {
  console.error("[SECURITE] DEV_MASTER_OTP est défini en production : il est ignoré, supprime-le des variables d'environnement.");
}
