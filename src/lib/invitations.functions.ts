// Invitation-based account activation: a Super Admin creates the tenant and its owner user
// (no password), this issues a single-use "set your password" link, and activateAccountFor
// is the public endpoint that consumes it. Token storage mirrors Session.tokenHash (sessions.ts):
// only the SHA-256 hash is ever persisted, so a database leak does not yield a usable link.
import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { requireSuperAdmin } from "@/lib/auth.server";
import { db } from "@/lib/db.server";
import {
  createSession,
  hashToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  type SessionUser,
} from "@/lib/sessions";
import { hashPassword } from "@/lib/password";
import { EmailNotConfiguredError, sendEmail } from "@/lib/email/email-service";
import { invitationEmail } from "@/lib/email/templates";

export const INVITATION_TTL_HOURS = 24;
export const MIN_PASSWORD_LENGTH = 12;

function appBaseUrl(): string {
  const base = process.env["APP_BASE_URL"];
  if (!base) throw new Error("APP_BASE_URL is not configured.");
  return base.replace(/\/+$/, "");
}

function activationUrl(token: string): string {
  return `${appBaseUrl()}/activate?token=${encodeURIComponent(token)}`;
}

/** What the caller (Super Admin console) should show after trying to send an invitation.
 * emailSent: false is not a failure of the invitation itself — the token was issued either
 * way — it only means delivery didn't happen, so the console must surface activationUrl for
 * the admin to share by hand (exactly the "credentials not provided yet" case). */
export type InvitationDispatch =
  { emailSent: true } | { emailSent: false; activationUrl: string; reason: string };

/** Issues a brand-new invitation row and attempts delivery. Never throws on a delivery
 * failure — the invitation always exists in the database once this returns, so a retried
 * "resend" or a later manual share never loses the invite. */
export async function issueInvitation(
  database: PrismaClient,
  params: {
    clientId: string;
    userId: string;
    email: string;
    fullName: string;
    businessName: string;
    invitedBy: string;
  },
  now = new Date(),
): Promise<InvitationDispatch> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_HOURS * 60 * 60 * 1000);
  await database.invitation.create({
    data: {
      clientId: params.clientId,
      userId: params.userId,
      email: params.email,
      tokenHash: hashToken(token),
      invitedBy: params.invitedBy,
      expiresAt,
    },
  });

  const url = activationUrl(token);
  try {
    await sendEmail(
      invitationEmail({
        to: params.email,
        fullName: params.fullName,
        businessName: params.businessName,
        activationUrl: url,
        expiresInHours: INVITATION_TTL_HOURS,
      }),
    );
    return { emailSent: true };
  } catch (error) {
    const reason =
      error instanceof EmailNotConfiguredError
        ? "Email delivery is not configured (set RESEND_API_KEY and EMAIL_FROM). Share the activation link below yourself."
        : error instanceof Error
          ? error.message
          : "Could not send the invitation email.";
    console.error(`[invitations] delivery failed for ${params.email}: ${reason}`);
    return { emailSent: false, activationUrl: url, reason };
  }
}

export type InvitationStatus = "pending" | "expired" | "revoked" | "accepted";

export interface InvitationSummary {
  email: string;
  status: InvitationStatus;
  expiresAt: string;
}

/** The most recent invitation for a tenant, for the Super Admin console to show next to the
 * tenant's admin account. Null means none was ever issued (shouldn't happen for a tenant
 * created through createTenantFor, but older/hand-provisioned tenants may have none). */
export async function getInvitationStatusFor(
  database: PrismaClient,
  clientId: string,
): Promise<InvitationSummary | null> {
  const invitation = await database.invitation.findFirst({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    select: { email: true, expiresAt: true, acceptedAt: true, revokedAt: true },
  });
  if (!invitation) return null;
  const now = new Date();
  const status: InvitationStatus = invitation.acceptedAt
    ? "accepted"
    : invitation.revokedAt
      ? "revoked"
      : invitation.expiresAt <= now
        ? "expired"
        : "pending";
  return { email: invitation.email, status, expiresAt: invitation.expiresAt.toISOString() };
}

const clientIdSchema = z.object({ clientId: z.string().uuid() });
export type ResendInvitationInput = z.infer<typeof clientIdSchema>;

/** Revokes whatever invitation is currently outstanding for this tenant (if any) and issues a
 * new one — a resend is a new token, not a re-delivery of the old one, so an old copy of the
 * email (or a leaked link) stops working the moment a fresh one is sent. */
export async function resendInvitationFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: ResendInvitationInput,
): Promise<{ ok: true; invitation: InvitationDispatch } | { ok: false; reason: string }> {
  const [client, latest] = await Promise.all([
    database.client.findUnique({ where: { id: input.clientId }, select: { id: true, name: true } }),
    database.invitation.findFirst({
      where: { clientId: input.clientId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        email: true,
        acceptedAt: true,
        user: { select: { fullName: true, passwordHash: true } },
      },
    }),
  ]);
  if (!client) return { ok: false, reason: "Tenant not found." };
  if (!latest) return { ok: false, reason: "This tenant has no invitation to resend." };
  if (latest.acceptedAt || latest.user.passwordHash) {
    return { ok: false, reason: "This account has already been activated." };
  }

  const now = new Date();
  await database.invitation.update({ where: { id: latest.id }, data: { revokedAt: now } });
  const invitation = await issueInvitation(
    database,
    {
      clientId: client.id,
      userId: latest.userId,
      email: latest.email,
      fullName: latest.user.fullName,
      businessName: client.name,
      invitedBy: superAdminUserId,
    },
    now,
  );
  console.log(`[super-admin] invitation resent: client=${client.id} by=${superAdminUserId}`);
  return { ok: true, invitation };
}

/** Revokes the current pending invitation without issuing a new one. */
export async function revokeInvitationFor(
  database: PrismaClient,
  superAdminUserId: string,
  input: ResendInvitationInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pending = await database.invitation.findFirst({
    where: { clientId: input.clientId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!pending) return { ok: false, reason: "There is no pending invitation to revoke." };
  await database.invitation.update({ where: { id: pending.id }, data: { revokedAt: new Date() } });
  console.log(`[super-admin] invitation revoked: client=${input.clientId} by=${superAdminUserId}`);
  return { ok: true };
}

export interface InvitationPreview {
  email: string;
  businessName: string;
}

/** Read-only check for the activation page to greet the invitee by name/workspace before they
 * type a password — never mutates anything, so it is safe to call on every page load. */
export async function getInvitationPreviewFor(
  database: PrismaClient,
  token: string,
  now = new Date(),
): Promise<{ ok: true; preview: InvitationPreview } | { ok: false; reason: string }> {
  const invitation = await database.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      email: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      client: { select: { name: true } },
    },
  });
  if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= now) {
    return { ok: false, reason: "This invitation link is invalid or has expired." };
  }
  return { ok: true, preview: { email: invitation.email, businessName: invitation.client.name } };
}

export type ActivateAccountResult =
  { ok: true; user: SessionUser; token: string; expiresAt: Date } | { ok: false; reason: string };

/** Consumes a single-use invitation token: sets the invited user's password and marks the
 * token accepted in one transaction, then logs them straight in (same session issuance as a
 * normal sign-in — see createSession in sessions.ts). */
export async function activateAccountFor(
  database: PrismaClient,
  input: { token: string; password: string },
  now = new Date(),
): Promise<ActivateAccountResult> {
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > 200) {
    return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  const invitation = await database.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      user: { select: { id: true, email: true, fullName: true } },
    },
  });
  if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= now) {
    return { ok: false, reason: "This invitation link is invalid or has expired." };
  }

  const passwordHash = await hashPassword(input.password);
  await database.$transaction([
    database.user.update({ where: { id: invitation.userId }, data: { passwordHash } }),
    database.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: now } }),
  ]);
  const { token, expiresAt } = await createSession(database, invitation.userId, now);
  return { ok: true, user: invitation.user, token, expiresAt };
}

export const resendInvitation = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(clientIdSchema)
  .handler(({ context, data }) => resendInvitationFor(db, context.userId, data));

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSuperAdmin])
  .validator(clientIdSchema)
  .handler(({ context, data }) => revokeInvitationFor(db, context.userId, data));

export const getInvitationPreview = createServerFn({ method: "GET" })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(({ data }) => getInvitationPreviewFor(db, data.token));

export const activateAccount = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(1), password: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const result = await activateAccountFor(db, data);
    if (!result.ok) return result;
    setCookie(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return { ok: true as const, user: result.user };
  });
