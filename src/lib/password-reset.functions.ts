// Self-service "forgot password" for an already-activated account. Separate from Invitation
// (invitations.functions.ts) because it targets an existing user rather than a pending one, but
// shares the same token-hashing, email and password-hashing building blocks.
import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { db } from "@/lib/db.server";
import { hashToken } from "@/lib/sessions";
import { hashPassword } from "@/lib/password";
import { EmailNotConfiguredError, sendEmail } from "@/lib/email/email-service";
import { passwordResetEmail } from "@/lib/email/templates";

const RESET_TTL_HOURS = 1;
const MIN_PASSWORD_LENGTH = 12;

function appBaseUrl(): string {
  const base = process.env["APP_BASE_URL"];
  if (!base) throw new Error("APP_BASE_URL is not configured.");
  return base.replace(/\/+$/, "");
}

function resetUrl(token: string): string {
  return `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Always returns ok:true regardless of whether the email matches an account — this is a
 * deliberate enumeration guard (the same posture as the generic INVALID_CREDENTIALS message
 * in sessions.ts). A pending invitation (passwordHash still null) is not a valid reset target:
 * that user has no password to reset yet, so the invitation flow is what applies there.
 */
export async function requestPasswordResetFor(
  database: PrismaClient,
  email: string,
  now = new Date(),
): Promise<{ ok: true }> {
  const user = await database.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, fullName: true, passwordHash: true },
  });
  if (!user?.passwordHash) return { ok: true };

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + RESET_TTL_HOURS * 60 * 60 * 1000);
  await database.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
  });

  try {
    await sendEmail(
      passwordResetEmail({
        to: user.email,
        fullName: user.fullName,
        resetUrl: resetUrl(token),
        expiresInHours: RESET_TTL_HOURS,
      }),
    );
  } catch (error) {
    const reason =
      error instanceof EmailNotConfiguredError
        ? "Email delivery is not configured (set RESEND_API_KEY and EMAIL_FROM)."
        : error instanceof Error
          ? error.message
          : "Could not send the password reset email.";
    // Still ok:true to the caller (no enumeration signal), but logged so an operator can see
    // resets are silently failing to deliver.
    console.error(`[password-reset] delivery failed for ${user.email}: ${reason}`);
  }
  return { ok: true };
}

export type ResetPasswordResult = { ok: true } | { ok: false; reason: string };

/** Consumes a single-use reset token, sets the new password, and revokes every existing
 * session for that user (a password reset is exactly when old sessions should stop working —
 * unlike activateAccountFor, this does not log the caller back in; they sign in fresh). */
export async function resetPasswordFor(
  database: PrismaClient,
  input: { token: string; password: string },
  now = new Date(),
): Promise<ResetPasswordResult> {
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > 200) {
    return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  const record = await database.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!record || record.usedAt || record.expiresAt <= now) {
    return { ok: false, reason: "This reset link is invalid or has expired." };
  }

  const passwordHash = await hashPassword(input.password);
  await database.$transaction([
    database.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    database.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    database.session.deleteMany({ where: { userId: record.userId } }),
  ]);
  return { ok: true };
}

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().trim().max(255) }))
  .handler(({ data }) => requestPasswordResetFor(db, data.email));

export const resetPassword = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(1), password: z.string().min(1).max(200) }))
  .handler(({ data }) => resetPasswordFor(db, data));
