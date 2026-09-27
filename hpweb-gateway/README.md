# DiagAssist HP-Web Gateway

Service Playwright dédié à la recherche de véhicules dans HP-Web.

## Variables Render
- `HP_WEB_URL=https://hp-web.in`
- `HP_WEB_USERNAME=...`
- `HP_WEB_PASSWORD=...`
- `HP_WEB_GATEWAY_API_KEY=...`
- `HP_WEB_TIMEOUT_MS=12000` (optionnel)
- `HP_WEB_CACHE_TTL_MS=900000` (optionnel)
- `PORT=10000`

Ne jamais commiter les identifiants, cookies, storage state ou captures de session.

## API
- `GET /health`
- `POST /vehicle/search`

La route n'est pas un proxy générique. Elle accepte uniquement les critères véhicule: VIN, marque, modèle, année, moteur ou recherche libre.

## Important
Les sélecteurs HP-Web ne sont pas encore certifiés contre une session réelle. Le premier déploiement doit servir à vérifier le flux de connexion et la recherche; si HP-Web utilise une UI/API différente, les sélecteurs seront ajustés après cette vérification.
