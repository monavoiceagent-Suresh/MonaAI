-- Deliberately loosens an existing invariant (added in 20261026174500_db_constraints:
-- "Clients: balance can never go negative"). The Super Admin console's manual credit
-- adjustments (src/lib/super-admin-credits.functions.ts) can now deduct a tenant below zero —
-- an outstanding negative balance is a first-class concept there (overview totals, the
-- tenant-wise filter, and the main Overview's highlight all depend on this being possible).
--
-- Nothing else in the codebase writes to clients.credit_balance today (campaigns.functions.ts
-- only ever reads it to gate dispatch), so this does not change behavior anywhere outside the
-- new Super Admin credit adjustment feature.
ALTER TABLE "clients" DROP CONSTRAINT "clients_credit_balance_non_negative";
