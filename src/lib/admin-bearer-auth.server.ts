// Static bearer-secret check for a server-triggered admin route that has no browser session
// to authenticate (an ops script hitting production, not a signed-in Super Admin) — the same
// shape as the engine's own Dashboard→Engine auth (Authorization: Bearer {APP_SECRET_KEY},
// see docs/technical/security.md) and the HMAC compare in voice-engine/webhook.ts, just without
// a signed body to verify.
import { timingSafeEqual } from "node:crypto";

export function verifyBearerToken(authorizationHeader: string | null, expected: string): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const provided = authorizationHeader.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
