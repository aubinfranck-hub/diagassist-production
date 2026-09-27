# HP-Web Gateway

Passerelle dédiée aux données véhicule HP-Web pour DiagAssist.

## Recherches prévues
- VIN
- marque
- modèle
- année
- motorisation
- recherche libre

Le gateway n'expose aucune route proxy générique. Les sélecteurs et endpoints HP-Web sont configurés uniquement après découverte locale.

## Production
Secrets via variables d'environnement Render uniquement. Ne jamais commiter les identifiants, cookies ou session_template.json.

## Découverte
Le script local de découverte doit capturer les appels XHR/fetch lors d'une recherche VIN et lors d'une recherche marque/modèle. Les routes réelles seront ensuite branchées dans le service.
