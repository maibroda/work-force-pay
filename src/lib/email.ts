import { Resend } from "resend";
import { logger } from "./logger";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const FROM = process.env.EMAIL_FROM ?? "WorkforcePay <onboarding@resend.dev>";

/**
 * Sends via Resend when RESEND_API_KEY is configured; otherwise logs the email (including any
 * links/codes in the body) so local development and CI never need a real provider.
 */
export async function sendEmail(email: Email): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.info("email_dev_transport", { to: email.to, subject: email.subject, text: email.text });
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: FROM,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (error) {
    logger.error("email_send_failed", { to: email.to, subject: email.subject, error });
    throw new Error("Failed to send email.");
  }
}
