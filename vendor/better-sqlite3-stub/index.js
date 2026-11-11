"use strict";
// Remplace better-sqlite3 (dépendance native de @cardog/corgi) : DiagAssist lit la base VIN avec
// le module intégré node:sqlite via l'adaptateur D1 de Corgi, donc ce module n'est jamais utilisé.
class Database {
  constructor() {
    throw new Error("better-sqlite3 n'est pas installé dans DiagAssist : utiliser src/modules/vin/vinDecoder.ts (node:sqlite).");
  }
}
module.exports = Database;
module.exports.default = Database;
