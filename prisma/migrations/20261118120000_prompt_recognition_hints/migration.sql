-- Speech Recognition Prompting: a persona's ASR vocabulary. Additive with an empty default, so every existing
-- persona keeps standard recognition and older revision snapshots read back as empty.
ALTER TABLE "prompts" ADD COLUMN "recognition_hints" TEXT NOT NULL DEFAULT '';
