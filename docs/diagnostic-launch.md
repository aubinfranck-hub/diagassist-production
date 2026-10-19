# Service diagnostic à Abidjan

Application autonome sur `/diagnostic` et sur l'hôte `diagnostic.diagassist.app` du même service Render. Aucun nouveau serveur requis.

## Tarifs

- Centre : 3 000 F CFA, acompte de 1 000 F.
- Domicile sur rendez-vous : 5 000 F TTC, acompte de 2 000 F (tiers arrondi au millier supérieur).
- Immédiat selon créneau disponible : 7 000 F TTC, intégral avant déplacement.
- Solde payé dans l'application. Publication ET confirmation du paiement intégral obligatoires pour accéder aux rapports et pièces jointes.

## Configuration pour l'ouverture

1. Ajouter `diagnostic.diagassist.app` aux domaines du service Render existant.
2. Configurer le CNAME DNS `diagnostic` vers `diagassist-production.onrender.com`, vérifier le domaine et le certificat TLS dans Render.
3. Définir `DIAGNOSTIC_PUBLIC_URL=https://diagnostic.diagassist.app`. Sans cette variable, les retours Jèko utilisent `https://www.diagassist.app/diagnostic`.
4. Depuis `/diagnostic/admin`, se connecter avec un compte DiagAssist administrateur. Renseigner l'adresse réelle, le téléphone d'assistance et les conditions de réservation / annulation / remboursement approuvées.
5. Les techniciens créent leur compte DiagAssist. L'administrateur les ajoute à l'équipe puis publie leurs créneaux réels. Horaires 8 h–18 h, dimanche compris. Inclure le temps de déplacement. Les chevauchements sont refusés.
6. Activer les réservations, puis l'immédiat si une équipe est disponible.
7. Vérifier un paiement autorisé auprès du prestataire, l'acompte, le solde, les rapports et le reçu avant toute campagne commerciale.

La configuration initiale garde les réservations fermées : aucun contact, adresse, créneau ni condition commerciale n'est inventé.

## Exploitation

Les techniciens utilisent « Équipe » sur mobile pour démarrer une mission confirmée, saisir le diagnostic et l'entretien, joindre jusqu'à huit PDF/JPEG/PNG de 1 Mo, puis publier. Le rapport publié est conservé sans modification.

Une notification de paiement signée est traitée de façon idempotente. Un paiement reçu après expiration ou annulation passe en régularisation ; il ne reprend pas un créneau déjà réattribué. Une annulation avec paiement demande un traitement de remboursement par l'équipe. Aucun remboursement automatique n'est annoncé ni exécuté.

Une demande de paiement dont la réponse du prestataire est incertaine bloque les nouvelles tentatives pour éviter les doubles débits. Si aucun identifiant prestataire n'est reçu, l'équipe doit rapprocher la référence avec Jèko ; ne pas supprimer le paiement pour permettre un nouvel essai sans vérification.

## Vérification technique

`npm run build`, `npm test`, `npm run test:assistance`, `npm audit --omit=dev --audit-level=high`.
Les tests avec `TEST_DATABASE_URL` couvrent la concurrence, les montants calculés côté serveur, la signature du paiement, les notifications répétées, le solde et le verrouillage des rapports, ainsi que les paiements tardifs. Ils utilisent un schéma `diagnostic_tests` séparé et un prestataire simulé ; ils ne débitent personne.
