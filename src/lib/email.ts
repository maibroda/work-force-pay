import { Resend } from "resend";
import { logger } from "./logger";
import { maskEmail } from "./sales/privacy";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
  /** Extra message headers, for example List-Unsubscribe on marketing mail. */
  headers?: Record<string, string>;
}

const FROM = process.env.EMAIL_FROM ?? "WorkforcePay <onboarding@resend.dev>";

/**
 * Sends via Resend when RESEND_API_KEY is configured; otherwise logs the email (including any
 * links/codes in the body) so local development and CI never need a real provider.
 */
export async function sendEmail(email: Email): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // in production with no provider the message must not end up in the log (it can hold a reset link or a payslip): say who it was for, masked, and why it was not sent
    if (process.env.NODE_ENV === "production") {
      logger.error("email_not_sent", { to: maskEmail(email.to), subject: email.subject, reason: "No email provider is configured (RESEND_API_KEY), so this message was not sent." });
      return;
    }
    logger.info("email_dev_transport", { to: email.to, subject: email.subject, text: email.text, headers: email.headers, attachments: email.attachments?.map((a) => ({ filename: a.filename, bytes: a.content.length })) });
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: FROM,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(email.headers ? { headers: email.headers } : {}),
    ...(email.attachments?.length ? { attachments: email.attachments.map((a) => ({ filename: a.filename, content: a.content })) } : {}),
  });
  if (error) {
    logger.error("email_send_failed", { to: maskEmail(email.to), subject: email.subject, error });
    throw new Error("Failed to send email.");
  }
}
