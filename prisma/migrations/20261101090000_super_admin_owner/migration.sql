-- Platform-wide Super Admin owner flag on the existing users table. Kept separate from
-- client_members.role, which is a per-workspace (tenant) role and has no bearing on platform access.
ALTER TABLE "users" ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

-- Partial unique index: Postgres only enforces uniqueness among rows where the indexed
-- expression is true, so this allows unlimited "false" rows but at most one "true" row,
-- i.e. at most one Super Admin account platform-wide.
CREATE UNIQUE INDEX "users_single_super_admin" ON "users" ("is_super_admin") WHERE "is_super_admin" = true;
