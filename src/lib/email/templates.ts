import { monaLogoUrl } from "@/lib/branding";
import type { EmailMessage } from "./email-service";

// A single shared shell so every Mona email looks like the same product. Plain, table-free
// HTML with inline styles only — the common denominator that survives Gmail/Outlook's CSS
// stripping, same tradeoff as any transactional-email template.
function shell(preheader: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:'Hanken Grotesk',Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 0;">
                <img src="${monaLogoUrl}" alt="Mona" height="32" style="display:block;" />
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px;color:#1c1f2a;font-size:14px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
          </table>
          <p style="margin-top:20px;color:#8a8f9c;font-size:12px;">
            Mona — AI Voice Agent
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#1c3fae;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;">${label}</a>`;
}

export function invitationEmail(input: {
  to: string;
  fullName: string;
  businessName: string;
  activationUrl: string;
  expiresInHours: number;
}): EmailMessage {
  const subject = `You're invited to set up ${input.businessName} on Mona`;
  const html = shell(
    subject,
    `
    <h1 style="margin:0 0 12px;font-size:18px;">Welcome to Mona, ${escapeHtml(input.fullName)}</h1>
    <p style="margin:0 0 4px;">You've been set up as the owner of <strong>${escapeHtml(input.businessName)}</strong>'s workspace.</p>
    <p style="margin:12px 0 0;">Set your password to activate your account and sign in.</p>
    ${button(input.activationUrl, "Set your password")}
    <p style="margin:0;color:#6b7280;">This link expires in ${input.expiresInHours} hours and can only be used once.</p>
    <p style="margin:16px 0 0;color:#6b7280;word-break:break-all;">Or paste this into your browser: ${input.activationUrl}</p>
  `,
  );
  const text =
    `Welcome to Mona, ${input.fullName}\n\n` +
    `You've been set up as the owner of ${input.businessName}'s workspace.\n` +
    `Set your password to activate your account: ${input.activationUrl}\n\n` +
    `This link expires in ${input.expiresInHours} hours and can only be used once.`;
  return { to: input.to, subject, html, text };
}

export function passwordResetEmail(input: {
  to: string;
  fullName: string;
  resetUrl: string;
  expiresInHours: number;
}): EmailMessage {
  const subject = "Reset your Mona password";
  const html = shell(
    subject,
    `
    <h1 style="margin:0 0 12px;font-size:18px;">Reset your password</h1>
    <p style="margin:0;">Hi ${escapeHtml(input.fullName)}, we received a request to reset your Mona password.</p>
    ${button(input.resetUrl, "Reset password")}
    <p style="margin:0;color:#6b7280;">This link expires in ${input.expiresInHours} hour(s). If you didn't request this, you can ignore this email — your password won't change.</p>
    <p style="margin:16px 0 0;color:#6b7280;word-break:break-all;">Or paste this into your browser: ${input.resetUrl}</p>
  `,
  );
  const text =
    `Hi ${input.fullName}, we received a request to reset your Mona password.\n` +
    `Reset it here: ${input.resetUrl}\n\n` +
    `This link expires in ${input.expiresInHours} hour(s). If you didn't request this, you can ignore this email.`;
  return { to: input.to, subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
