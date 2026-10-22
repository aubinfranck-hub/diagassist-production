# Boutique, dépannage et rappels vocaux WhatsApp

## Parcours livré

- Boutique : recherche Fuse.js sur le nom, la marque, le modèle, la compatibilité et la description ; fautes et accents tolérés. Prix sur demande placés après les prix connus. Affichage par lots de 24 produits. La correspondance de recherche ne certifie pas la compatibilité mécanique.
- Dépannage : comparaison par prix, délai ou note, filtres budget/délai, exclusion des offres expirées et vérification de leur expiration au clic de confirmation.
- Formulaire de rappel vocal dans la boutique, sur chaque produit et dans le dépannage. Le contexte produit est vérifié ; un dossier de dépannage nécessite la session de son propriétaire.
- File commune dans Boutique > Rappels et Assistance > Rappels WhatsApp. Consentement daté, filtres par service, pagination, résultat fournisseur et compte rendu opérateur.
- Sans configuration d’appel, les demandes restent traitables manuellement dans WhatsApp. Aucun lien `wa.me` n’est présenté comme un déclencheur d’appel.

## Activation des appels depuis l’administration

L’intégration utilise le fournisseur Twilio déjà présent dans le projet. L’existence de ces variables ne prouve pas l’éligibilité du compte : activer le sender WhatsApp pour Voice dans Twilio et vérifier les prérequis WhatsApp Business Calling du compte avant activation.

Variables serveur (ne pas les exposer au navigateur) :

```dotenv
WHATSAPP_CALLING_ENABLED=false
WHATSAPP_CALLBACK_PUBLIC_URL=https://votre-domaine.example
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+225...
WHATSAPP_CALL_PERMISSION_CONTENT_SID=HX...
WHATSAPP_CALLBACK_SIP=sip:conseiller@votre-domaine-sip.example
```

1. Créer et faire approuver un template `twilio/call-to-action` contenant l’action `VOICE_CALL_REQUEST`, utilisable hors fenêtre de conversation. Placer son Content SID dans la variable dédiée ; ne pas réutiliser un template de relance commerciale.
2. Conserver le webhook Messaging du sender sur `https://votre-domaine.example/api/shop/whatsapp/incoming`. Il distribue les autorisations vocales au nouveau module et conserve le traitement STOP des relances commerciales. `APP_URL` et `WHATSAPP_CALLBACK_PUBLIC_URL` doivent correspondre exactement à l’origine HTTPS publique, sans chemin ni slash final.
3. Préparer un poste SIP accessible depuis Twilio et vérifier sa disponibilité. Le pont WhatsApp vers le réseau téléphonique classique (PSTN) n’est pas permis. Le code raccorde l’appel au poste SIP après la réponse du client ; ce poste doit être disponible au moment du clic.
4. Activer `WHATSAPP_CALLING_ENABLED=true` après validation du compte, du template et du poste. L’opérateur clique « Demander l’autorisation » ; le client accepte dans WhatsApp ; l’opérateur peut alors cliquer « Appeler sur WhatsApp ».
5. Le statut d’appel est reçu automatiquement sur `/api/callbacks/whatsapp/status?id=<UUID>`, avec vérification de signature, compte, sender, destinataire et Call SID. Après la fin de l’appel, l’opérateur vérifie le résultat et clique « Marquer traité » avec son compte rendu. `completed` chez Twilio signifie que l’appel a pris fin, pas que le besoin client a été résolu.

Documentation fournisseur : https://www.twilio.com/docs/voice/whatsapp-business-calling

## Contrôles et exploitation

- Aucun appel ni message automatique à la soumission du formulaire : chaque action sortante nécessite un administrateur et une confirmation dans l’interface.
- Autorisation vocale distincte du consentement formulaire ; validité locale limitée à sept jours même si l’autorisation reçue est permanente. Un refus ou STOP invalide les permissions locales et annule les rappels en attente.
- Limites conservatrices par destinataire : une demande d’autorisation par 24 heures, deux par sept jours, cinq tentatives d’appel par 24 heures ; les tentatives fournisseur en erreur restent comptées. Twilio peut imposer d’autres restrictions.
- Déduplication des formulaires sur 15 minutes, rate limit HTTP existant et verrou PostgreSQL par destinataire. Aucun accès public à la liste ou au suivi nominatif des rappels.
- Un seul appel API par dossier, sans nouvelle tentative automatique. Les appels simultanés vers le même numéro sont bloqués. Les événements de permission sont dédupliqués par Message SID, les événements de fin d’appel ne sont pas rétrogradés par une livraison tardive.
- Si une requête d’appel expire sans confirmation fournisseur, le dossier reste « Appel en cours » avec une erreur explicite : vérifier le journal Twilio et rétablir la livraison du webhook. Ne pas créer de nouvel appel avant d’avoir réconcilié le premier. Aucun bouton ne force une relance ambiguë.
- Schéma PostgreSQL créé de manière idempotente au démarrage ; tables `voice_callbacks`, `voice_callback_permissions`, `voice_callback_events`, `voice_callback_attempts`.

## Validation avant mise en service

`npm test` couvre la recherche, la comparaison, les contrôles d’accès, la signature webhook, les doublons et le cycle permission/appel avec un fournisseur simulé et PostgreSQL embarqué PGlite. `npm run build` vérifie TypeScript et les bundles.

Avant ouverture réelle, effectuer un essai avec un numéro de test consentant et un poste SIP disponible : réception du template, accord/refus, sonnerie, audio dans les deux sens, fin d’appel et suivi dans l’administration. Aucun appel réel n’est effectué par les tests automatisés.
