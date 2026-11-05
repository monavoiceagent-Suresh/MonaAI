-- Fails safely if existing data violates the invariant; resolve duplicates before retrying.
CREATE UNIQUE INDEX phone_numbers_one_default_per_tenant
ON phone_numbers (client_id) WHERE is_default_outbound_caller_id AND client_id IS NOT NULL;
ALTER TABLE voice_engine_jobs ADD COLUMN credit_stop_pending boolean NOT NULL DEFAULT false;
