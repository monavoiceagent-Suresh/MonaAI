-- Classifies every credit_transactions row by where it came from, so Super Admin history and
-- analytics never again conflate a manual adjustment with an automated voice-usage debit
-- (see src/lib/super-admin-credits.functions.ts and src/lib/voice-engine/webhook.ts).
--
-- Existing rows cannot be reliably reclassified after the fact (guessing from the free-text
-- `note` column could easily mislabel a manual adjustment whose note happens to mention a job),
-- so every historical row becomes 'UNKNOWN' via the column default applied on this ALTER, and
-- stays that way. Only new rows, written by the two call sites updated alongside this
-- migration, ever get 'MANUAL_ADJUSTMENT' or 'VOICE_USAGE'.
ALTER TABLE "credit_transactions" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_type_known"
  CHECK ("type" IN ('MANUAL_ADJUSTMENT', 'VOICE_USAGE', 'UNKNOWN'));
