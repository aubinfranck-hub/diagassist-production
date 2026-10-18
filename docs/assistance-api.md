# Assistance automobile — contrat d'API

Toutes les routes renvoient `{ success: boolean, message?: string, ... }`. Les dates sont en millisecondes (epoch), les montants en entiers XOF.
Auth client / mécanicien : `Authorization: Bearer <auth_session_token>`. Auth admin : mêmes en-têtes que le reste de l'admin (`x-admin-code` ou session admin).
Si Postgres n'est pas configuré, toutes les routes `/api/assistance/*` répondent `503 { success:false, code:"ASSISTANCE_DB_MISSING", message }` (sauf `GET /api/assistance/status`).

## Statuts
- `status` (intervention) : `brouillon, recherche, affectee, en_route, sur_place, en_intervention, terminee, sans_disponibilite, annulee`
- `quoteStatus` : `aucun, propose, accepte, refuse` (`propose` tant qu'un devis attend l'accord du client)
- `paymentStatus` : `aucun, en_attente, especes_a_confirmer, paye, echoue`
- Pro `validationStatus` : `en_attente, valide, suspendu, refuse`
- Services (code) : `mecanique, electricite, diagnostic, batterie, pneumatiques, remorquage, vidange`

## Client
- `GET /api/assistance/status` → `{ enabled, dbConfigured, paymentConfigured, whatsappConfigured, services:[{code,label,description,available,proCount,availableNow}], zones:[{id,name}], paymentMethods:["wave","orange","mtn","moov","especes"] }`
- `POST /api/assistance/requests` body `{ service, vehicle:{brand?,model?,year?,engine?,source?:"catalogue"|"saisie"}, symptoms, faultCodes?, description?, contactPhone, position:{lat,lng,accuracy?,source:"gps"|"carte"|"adresse",address?,landmark?,confirmed:true}, shareDiagnostic?:boolean, diagnostic?:{summary,faultCodes?,vehicle?}, mediaIds?:string[], submit?:boolean }` → `{ request }`. `submit:true` lance directement la recherche. La position doit être `confirmed:true` pour passer en `recherche`.
- `PATCH /api/assistance/requests/:id` (brouillon seulement) mêmes champs.
- `POST /api/assistance/requests/:id/submit` · `/cancel {reason}` · `/retry` (depuis `sans_disponibilite`) · `/manual` (demande de prise en charge manuelle)
- `GET /api/assistance/requests` → `{ requests:[résumé] }` (historique du client)
- `GET /api/assistance/requests/:id` → `{ request, pro|null, quotes, payment|null, timeline, media, review|null, allowed:{cancel,retry,manual,pay,review,claim,decideQuote} }`
  - `pro` (après affectation) : `{ displayName, garageName, specialties, rating:{avg,count}|null, phone, trainings:[{title,issuer}], location:{lat,lng,updatedAt}|null, eta:{minutes,distanceKm,approximate:true}|null }`
  - `timeline` : `[{ at, label, status }]` version client (sans données internes)
- `POST /api/assistance/media` body `{ requestId?, mime, dataBase64, name? }` → `{ media:{id,kind,mime,size} }` (images jpeg/png/webp ≤ 5 Mo, vidéo mp4/webm ≤ 8 Mo, audio webm/ogg/mp4/mpeg ≤ 5 Mo ; 8 fichiers max par demande). Sans `requestId` : média orphelin rattaché à la création (`mediaIds`).
- `GET /api/assistance/media/:id` (Bearer, ou `?token=`) → octets du fichier si le client est propriétaire, le mécanicien affecté ou admin.
- `GET|POST /api/assistance/requests/:id/messages` (`?since=<id>`) → `{ messages:[{id,fromRole:"client"|"pro",body,at}] }` ; POST `{ body }`.
- `POST /api/assistance/requests/:id/quotes/:quoteId/decision` `{ accept:boolean }` — accord enregistré (date + auteur).
- `POST /api/assistance/requests/:id/pay` `{ method:"wave"|"orange"|"mtn"|"moov"|"especes", payerPhone? }` → `{ reference, redirectUrl? , paymentStatus }`. Mobile money : jamais « payé » avant webhook signé Jèko ; espèces : `especes_a_confirmer`.
- `GET /api/assistance/requests/:id/payment` → `{ payment, paymentStatus }` (rafraîchit auprès de Jèko si en attente)
- `POST /api/assistance/requests/:id/payments/:reference/confirm-cash` (le client confirme avoir remis les espèces)
- `POST /api/assistance/requests/:id/review` `{ rating:1..5, comment? }` · `POST /api/assistance/requests/:id/claims` `{ kind, message }`
- `GET /api/assistance/notifications` → `{ notifications:[{id,type,title,body,requestId,at,read}], unread }` · `POST /api/assistance/notifications/read` `{ ids? }`

## Mécanicien (`/api/assistance/pro/...`)
- `GET /pro/me` → `{ profile|null, directoryMatch:boolean }` ; `profile` = `{ phone, displayName, garageName, specialties, zoneIds, mobility:"mobile"|"garage"|"both", validationStatus, validationNote, available, shareLocation, location:{lat,lng,updatedAt}|null, trainings:[{id,title,issuer,completedOn,status}], documents:[{id,kind,label,status}], rating, missionsDone, activeMissionId|null, canReceiveMissions, blockers:[string] }`
- `PUT /pro/me` `{ displayName, garageName?, specialties:string[], zoneIds:number[], mobility }` (crée le profil en `en_attente` si absent)
- `POST /pro/documents` `{ kind, label, mime, dataBase64 }` (pdf/jpeg/png ≤ 4 Mo) · `POST /pro/trainings` `{ title, issuer, completedOn }` (déclaré, jamais affiché au client tant que non `verifiee`)
- `POST /pro/availability` `{ available:boolean, lat?, lng? }` (refusé si non `valide`)
- `POST /pro/location` `{ lat, lng, accuracy? }` (accepté seulement si disponible ou mission active ; sinon 409 pour arrêter le partage)
- `GET /pro/offers` → `{ offers:[{id,requestId,service,serviceLabel,vehicle,symptoms,approxPosition:{lat,lng,radiusM},distanceKm,expiresAt}] }` (position arrondie, sans repère ni téléphone)
- `POST /pro/offers/:id/accept` · `/decline` → accept renvoie `{ mission }` ou `409 { code:"ALREADY_TAKEN" }`
- `GET /pro/missions` (toutes, pour missions + paiements) · `GET /pro/missions/:id` → détail complet (position exacte, repère, téléphone client, dossier IA si consentement, médias, devis, messages, paiement)
- `POST /pro/missions/:id/status` `{ to:"en_route"|"sur_place"|"en_intervention"|"terminee" }` · `/release {reason}` (désistement) · `/diagnosis {text}`
- `POST /pro/missions/:id/quotes` `{ kind:"initial"|"supplementaire", lines:[{kind:"deplacement"|"diagnostic"|"main_oeuvre"|"pieces",label,amount}], note? }`
- `POST /pro/missions/:id/cash-received` (déclare avoir reçu des espèces → `especes_a_confirmer`)
- `GET /api/assistance/tariffs` → `{ tariffs:{ [service]:{deplacement?,diagnostic?} }, currency:"XOF" }` (valeurs de départ, configurées par l'admin)

## Admin (`/api/admin/assistance/...`)
- `GET /dashboard` → indicateurs réels (demandes reçues, acceptées, terminées, délais moyens d'acceptation / d'arrivée, montants encaissés, pros par statut)
- `GET /requests?status=&zoneId=&service=&from=&to=&manual=1` · `GET /requests/:id` (détail + chronologie complète + offres + messages) · `POST /requests/:id/assign {proPhone}` · `/redispatch` · `/cancel {reason}`
- `GET /pros?status=` · `POST /pros/:phone/validate|suspend|refuse {note?}` · `POST /pros/validate-directory` (valide tous les profils issus de l'annuaire en attente) · `PATCH /pros/:phone {specialties, zoneIds, mobility}` · `GET /pros/:phone/documents/:id` (fichier) · `POST /pros/:phone/documents/:id/verify {status}` · `POST /pros/:phone/trainings {title,issuer,completedOn,status}` · `POST /trainings/:id/verify {status}`
- `GET|POST|PATCH|DELETE /zones` · `GET /services` · `PATCH /services/:code {enabled,label}` · `GET|PUT /settings` (offer_timeout_s, search_radius_km, max_candidates, location_max_age_min, avg_speed_kmh, commission_pct, tariffs)
- `GET /payments` · `POST /payments/:reference/confirm-cash` · `GET /claims` · `POST /claims/:id/resolve {note}` · `POST /sync-directory`
