# Sources de données ouvertes utilisées par DiagAssist

DiagAssist embarque une base de codes défauts et un décodeur VIN qui fonctionnent **hors ligne**
(aucun appel réseau, aucun quota Gemini). Ce fichier liste les sources, leurs licences et les
obligations qui en découlent.

## Base de codes défauts — `src/modules/dtc/data/dtc-kb.json.gz`

Générée par `scripts/build-dtc-kb.py` (voir l'en-tête du script pour la regénérer).

| Source | Contenu repris | Licence | Obligations |
|---|---|---|---|
| [OBDex](https://github.com/foerbsnavi/obdex) (foerbsnavi) | ~9 500 codes génériques (P0, P2, P3, B0, C0, U0, U3) : titre, fonctionnement, causes classées par fréquence, symptômes, difficulté, durée et coût indicatifs, codes associés (textes anglais) | Données CC0 1.0, outils MIT | Aucune (domaine public). Attribution faite par courtoisie. |
| [dtc-database](https://github.com/Wal33D/dtc-database) (Wal33D) | ~9 400 définitions constructeur (P1xxx, B1xxx…) pour 33 marques + 166 codes génériques absents d'OBDex | MIT | Conserver la mention de copyright : « Copyright (c) 2024 Wal33D (Waleed Judah) », licence MIT. |
| [MechanicDB-public](https://github.com/MechanicDB/MechanicDB-public) (DataEngineered) | Échantillon gratuit : 90 codes avec explication détaillée et 326 procédures de contrôle classées | ODbL 1.0 (données), CC BY 4.0 (doc) | Attribution « MechanicDB » avec lien vers le dépôt. Les données sont conservées dans une section séparée (`mechanicdb`) ; toute version modifiée de cette section doit rester sous ODbL. La base complète (payante) n'est pas incluse. |

Couverture : les marques européennes très présentes en Côte d'Ivoire (Peugeot, Renault, Citroën) et
Hyundai n'ont pas de codes constructeur dans ces sources ; leurs codes génériques (P0/P2/U0…) sont couverts.

## Décodeur VIN — Corgi (`@cardog/corgi`)

| Source | Contenu | Licence |
|---|---|---|
| [Corgi](https://github.com/cardog-ai/corgi) (Cardog) | Décodage VIN hors ligne, base dérivée de NHTSA vPIC (données publiques du gouvernement américain) | ISC |

Corgi dépend normalement de `better-sqlite3` (module natif). DiagAssist le remplace par un stub
(`vendor/better-sqlite3-stub`, via `overrides` dans `package.json`) et lit la base avec le module
SQLite intégré de Node (`node:sqlite`, Node ≥ 22.13) grâce à l'adaptateur « D1 » de Corgi : aucune
compilation native au déploiement, base lue sur disque (dossier temporaire) plutôt qu'en mémoire.

Couverture : excellente pour les véhicules du marché américain (Toyota, Hyundai, Honda, Ford… très
importés en Côte d'Ivoire) ; partielle pour les VIN européens, qui sont alors signalés comme non décodés.

## Écartés volontairement

- Projets qui reposent sur un boîtier OBD/ELM327 (OBDb, AndrOBD, python-OBD, ELM327-emulator) :
  DiagAssist lit l'écran du scanner du mécanicien, pas la prise OBD.
- Dépôts sans licence réutilisable (Automotive-9/dtc-codes, OBD2HQ « tous droits réservés »).
