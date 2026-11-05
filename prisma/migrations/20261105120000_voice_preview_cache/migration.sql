-- One cached sample clip per voice, so the campaign wizard's Preview button only pays for TTS
-- synthesis against the voice engine once per voice, instead of on every click.
CREATE TABLE "voice_preview_cache" (
    "voice_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "audio" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_preview_cache_pkey" PRIMARY KEY ("voice_id")
);
