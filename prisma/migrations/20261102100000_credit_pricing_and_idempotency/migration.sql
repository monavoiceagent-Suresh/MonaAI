-- Super Admin credit management: a dedup key on the existing credit ledger (no new ledger),
-- and one new, single-row table for the platform's global credit price.

-- Nullable + unique: existing rows keep NULL (Postgres allows unlimited NULLs in a unique
-- index), new adjustments from the Super Admin console always set one, so a retried request
-- with the same key cannot be inserted twice.
ALTER TABLE "credit_transactions" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "credit_transactions_idempotency_key_key" ON "credit_transactions" ("idempotency_key");

-- One global credit price, applied to future adjustments only. Always exactly one row
-- (the application always reads/writes the fixed id below); historical credit_transactions
-- rows are never touched by a price change.
CREATE TABLE "credit_pricing" (
  "id" UUID NOT NULL,
  "price_per_credit" DECIMAL(10,4) NOT NULL DEFAULT 1,
  "updated_by" UUID,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "credit_pricing_pkey" PRIMARY KEY ("id")
);

INSERT INTO "credit_pricing" ("id", "price_per_credit", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', 1, now());
