# DiagAssist × HP-Web (extension navigateur)

Permet à l'assistant vocal de DiagAssist de naviguer dans HP-Web **avec la session et la licence du mécanicien**,
depuis son propre navigateur. Rien n'est copié : l'agent lit la vraie page HP-Web et n'invente rien.

## Installation (Chrome, Edge, Brave, Kiwi sur Android)
1. Ouvrir `chrome://extensions`, activer le **mode développeur**.
2. **Charger l'extension non empaquetée** et choisir ce dossier `hpweb-extension`.
3. Ouvrir DiagAssist, lancer un Live, puis se connecter à HP-Web dans l'onglet qui s'ouvre (une seule fois).
4. Dire par exemple : « Cherche la Peugeot 406 et donne-moi le fichier technique. »

## Fonctionnement
- `content-bridge.js` (page DiagAssist) : relaie les commandes du serveur vers l'extension.
- `background.js` : garde l'onglet HP-Web et exécute les commandes.
- `content-hpweb.js` (page HP-Web) : lit la page (texte + éléments numérotés) et clique, saisit, choisit.

## Sécurité
- Limité à `*.hp-web.in` et aux domaines DiagAssist listés dans `manifest.json`.
- L'agent ne peut ni ouvrir une URL arbitraire, ni lire ou remplir un champ mot de passe.
- Aucun identifiant ne transite par DiagAssist : le mécanicien se connecte lui-même.

## Limites actuelles
- Ne fonctionne pas dans l'application Android native ni dans un navigateur sans extensions (Chrome Android, Safari iOS).
- L'adresse d'accueil est `HP_WEB_HOME` dans `background.js` (par défaut `https://fr.hp-web.in/`).
- Ajouter le domaine de production dans `content_scripts.matches` de `manifest.json` s'il change.
