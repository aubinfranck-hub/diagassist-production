# Trajets routiers avec OSRM (optionnel)

Sans OSRM, DiagAssist estime la distance à vol d'oiseau × 1,4 et la divise par la vitesse moyenne
réglée dans l'admin du dépannage. Avec OSRM, le classement des mécaniciens, l'ETA d'une offre et le
temps d'arrivée affiché au client utilisent la **distance et la durée par la route**.

OSRM ne connaît pas le trafic en temps réel : ses durées sont « routes libres ». La variable
`OSRM_DURATION_FACTOR` (par ex. `1.4`) permet de les majorer d'après les trajets réels observés à
Abidjan. En cas de panne d'OSRM (délai de 2,5 s dépassé), DiagAssist revient automatiquement à
l'estimation actuelle.

## Hébergement (VPS, par ex. Contabo) — environ 1 Go de RAM

Avec Docker (image officielle `ghcr.io/project-osrm/osrm-backend`, licence BSD-2) :

```bash
mkdir -p ~/osrm && cd ~/osrm
# Carte OpenStreetMap de Côte d'Ivoire (Geofabrik). Vérifier le lien sur https://download.geofabrik.de/africa.html
wget https://download.geofabrik.de/africa/ivory-coast-latest.osm.pbf
docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/ivory-coast-latest.osm.pbf
docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/ivory-coast-latest.osrm
docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/ivory-coast-latest.osrm
docker run -d --restart unless-stopped --name osrm -p 5000:5000 -v "$PWD:/data" \
  ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld /data/ivory-coast-latest.osrm
```

Test : `curl "http://IP_DU_VPS:5000/route/v1/driving/-4.0083,5.3364;-3.9800,5.3600?overview=false"`
doit renvoyer `"code":"Ok"`.

Mettre la carte à jour (une fois par mois suffit) : retélécharger le `.pbf`, relancer les trois
commandes de préparation, puis `docker restart osrm`.

Sécurité : n'ouvrir le port 5000 qu'aux adresses de Render (pare-feu du VPS), ou placer OSRM
derrière un reverse-proxy HTTPS.

## Variables Render (service diagassist-production)

- `OSRM_URL` = `http://IP_DU_VPS:5000`
- `OSRM_DURATION_FACTOR` = `1.4` (optionnel, défaut 1)

Le serveur public de démonstration d'OSRM n'est pas destiné à un usage en production : ne pas l'utiliser.
