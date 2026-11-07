-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "voice_stability" DOUBLE PRECISION,
ADD COLUMN "voice_similarity_boost" DOUBLE PRECISION,
ADD COLUMN "voice_style" DOUBLE PRECISION;
