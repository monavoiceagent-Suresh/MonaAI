// Provider-abstracted outbound email. Server-only: reads RESEND_API_KEY, which must stay off
// the client bundle. Mirrors the voice engine client's shape (lib/voice-engine/client.ts) —
// a "not configured" error distinct from a delivery failure, so callers can tell apart
// "nobody set this up yet" from "the provider rejected the request" and report each clearly.
import { ResendEmailProvider } from "./resend-provider";

export class EmailNotConfiguredError extends Error {}
export class EmailDeliveryError extends Error {}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

function resolveProvider(): EmailProvider {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["EMAIL_FROM"];
  if (!apiKey || !from) {
    throw new EmailNotConfiguredError(
      "Email delivery is not configured: set RESEND_API_KEY and EMAIL_FROM.",
    );
  }
  return new ResendEmailProvider(apiKey, from);
}

/**
 * Sends one email through the configured provider. Throws EmailNotConfiguredError when
 * RESEND_API_KEY/EMAIL_FROM are missing, or EmailDeliveryError when the provider itself
 * rejected the send — callers decide how to surface each (see invitations.functions.ts,
 * which falls back to a manually-shareable link rather than losing the invitation).
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const provider = resolveProvider();
  try {
    await provider.send(message);
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) throw error;
    throw new EmailDeliveryError(
      error instanceof Error ? error.message : "The email provider rejected the request.",
    );
  }
}
