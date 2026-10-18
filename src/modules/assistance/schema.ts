// Schéma PostgreSQL du module Assistance automobile. Idempotent (CREATE ... IF NOT EXISTS) : exécuté à
// chaque démarrage comme le reste du schéma DiagAssist. Les utilisateurs restent dans `accounts`
// (clé = téléphone) et l'annuaire dans `mechanics` : aucune duplication des comptes.
export const ASSISTANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS assistance_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistance_zones (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL CHECK (radius_km > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistance_services (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assistance_pros (
  phone TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  garage_name TEXT,
  specialties TEXT[] NOT NULL DEFAULT '{}',
  zone_ids INTEGER[] NOT NULL DEFAULT '{}',
  mobility TEXT NOT NULL DEFAULT 'mobile' CHECK (mobility IN ('mobile','garage','both')),
  validation_status TEXT NOT NULL DEFAULT 'en_attente' CHECK (validation_status IN ('en_attente','valide','suspendu','refuse')),
  validation_note TEXT,
  validated_by TEXT,
  validated_at BIGINT,
  available BOOLEAN NOT NULL DEFAULT false,
  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  last_loc_at BIGINT,
  source TEXT NOT NULL DEFAULT 'inscription',
  directory_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistance_pros_status ON assistance_pros (validation_status, available);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistance_pros_directory ON assistance_pros (directory_id) WHERE directory_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS assistance_pro_documents (
  id SERIAL PRIMARY KEY,
  pro_phone TEXT NOT NULL REFERENCES assistance_pros(phone) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_verifier' CHECK (status IN ('a_verifier','verifie','refuse')),
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistance_trainings (
  id SERIAL PRIMARY KEY,
  pro_phone TEXT NOT NULL REFERENCES assistance_pros(phone) ON DELETE CASCADE,
  title TEXT NOT NULL,
  issuer TEXT,
  completed_on TEXT,
  status TEXT NOT NULL DEFAULT 'declaree' CHECK (status IN ('declaree','verifiee','refusee')),
  verified_by TEXT,
  verified_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistance_requests (
  id TEXT PRIMARY KEY,
  client_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','recherche','affectee','en_route','sur_place','en_intervention','terminee','sans_disponibilite','annulee')),
  service TEXT NOT NULL,
  vehicle JSONB NOT NULL DEFAULT '{}',
  symptoms TEXT,
  fault_codes TEXT,
  description TEXT,
  contact_phone TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  position_source TEXT,
  address TEXT,
  landmark TEXT,
  position_confirmed BOOLEAN NOT NULL DEFAULT false,
  zone_id INTEGER REFERENCES assistance_zones(id),
  share_diagnostic BOOLEAN NOT NULL DEFAULT false,
  diagnostic JSONB,
  pro_diagnosis TEXT,
  assigned_phone TEXT REFERENCES assistance_pros(phone),
  assigned_at BIGINT,
  quote_status TEXT NOT NULL DEFAULT 'aucun' CHECK (quote_status IN ('aucun','propose','accepte','refuse')),
  ai_analysis TEXT,
  amount_due INTEGER NOT NULL DEFAULT 0, -- montant convenu = somme des devis acceptés (règlement direct avec le mécanicien, hors plateforme)
  manual_requested BOOLEAN NOT NULL DEFAULT false,
  search_started_at BIGINT,
  cancel_reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_assistance_requests_client ON assistance_requests (client_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistance_requests_status ON assistance_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistance_requests_assigned ON assistance_requests (assigned_phone, status);
CREATE TABLE IF NOT EXISTS assistance_offers (
  id SERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES assistance_requests(id) ON DELETE CASCADE,
  pro_phone TEXT NOT NULL REFERENCES assistance_pros(phone),
  status TEXT NOT NULL DEFAULT 'envoyee' CHECK (status IN ('envoyee','acceptee','refusee','expiree','annulee')),
  distance_km DOUBLE PRECISION,
  sent_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  responded_at BIGINT
);
-- Envoi simultané à plusieurs mécaniciens : plusieurs propositions ouvertes par demande ; le premier à accepter l'emporte.
DROP INDEX IF EXISTS idx_assistance_offers_open;
CREATE INDEX IF NOT EXISTS idx_assistance_offers_req ON assistance_offers (request_id, status);
CREATE INDEX IF NOT EXISTS idx_assistance_offers_pro ON assistance_offers (pro_phone, status);
CREATE TABLE IF NOT EXISTS assistance_assignments (
  id SERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES assistance_requests(id) ON DELETE CASCADE,
  pro_phone TEXT NOT NULL REFERENCES assistance_pros(phone),
  assigned_at BIGINT NOT NULL,
  assigned_by TEXT NOT NULL,
  ended_at BIGINT,
  ended_reason TEXT
);
-- Garantie ultime : une demande n'a jamais deux affectations actives.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistance_assignments_active ON assistance_assignments (request_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS assistance_events (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES assistance_requests(id) ON DELETE CASCADE,
  at BIGINT NOT NULL,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  meta JSONB
);
CREATE INDEX IF NOT EXISTS idx_assistance_events_req ON assistance_events (request_id, at);
CREATE TABLE IF NOT EXISTS assistance_media (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES assistance_requests(id) ON DELETE CASCADE,
  owner_phone TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistance_media_req ON assistance_media (request_id);
CREATE TABLE IF NOT EXISTS assistance_messages (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES assistance_requests(id) ON DELETE CASCADE,
  from_phone TEXT NOT NULL,
  from_role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistance_messages_req ON assistance_messages (request_id, id);
CREATE TABLE IF NOT EXISTS assistance_quotes (
  id SERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES assistance_requests(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('initial','supplementaire')),
  lines JSONB NOT NULL,
  total INTEGER NOT NULL CHECK (total > 0),
  currency TEXT NOT NULL DEFAULT 'XOF',
  status TEXT NOT NULL DEFAULT 'propose' CHECK (status IN ('propose','accepte','refuse','remplace')),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  decided_at BIGINT,
  decided_by TEXT,
  UNIQUE (request_id, version)
);
-- Un seul devis en attente d'accord par demande.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistance_quotes_pending ON assistance_quotes (request_id) WHERE status = 'propose';
CREATE TABLE IF NOT EXISTS assistance_reviews (
  request_id TEXT PRIMARY KEY REFERENCES assistance_requests(id) ON DELETE CASCADE,
  author_phone TEXT NOT NULL,
  pro_phone TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS assistance_claims (
  id SERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES assistance_requests(id) ON DELETE CASCADE,
  author_phone TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ouverte' CHECK (status IN ('ouverte','resolue')),
  admin_note TEXT,
  created_at BIGINT NOT NULL,
  resolved_at BIGINT
);
CREATE TABLE IF NOT EXISTS assistance_notifications (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  request_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  created_at BIGINT NOT NULL,
  read_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_assistance_notifications_phone ON assistance_notifications (phone, id DESC);

-- Migration sûre si une version précédente du schéma existait.
ALTER TABLE assistance_requests ADD COLUMN IF NOT EXISTS ai_analysis TEXT;
ALTER TABLE assistance_requests DROP COLUMN IF EXISTS payment_status;
DROP TABLE IF EXISTS assistance_payments;
`;
