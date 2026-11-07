-- CreateTable
CREATE TABLE "ops_locks" (
    "key" TEXT NOT NULL,
    "acquired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ops_locks_pkey" PRIMARY KEY ("key")
);
