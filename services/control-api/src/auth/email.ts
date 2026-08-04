import { Resend } from "resend";
import { getEnv } from "../env.js";
import { buildAuthEmail, type AuthEmailKind } from "./email-template.js";

export async function sendOtpEmail(input: {
  email: string;
  otp: string;
  type: AuthEmailKind;
}) {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "development") {
      console.warn("[auth] Resend is not configured; transactional email delivery is disabled.");
      return;
    }
    throw new Error("Email provider is not configured");
  }

  const message = buildAuthEmail(input.type, input.otp);
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: `${env.RESEND_FROM_NAME} <${env.RESEND_FROM_EMAIL}>`,
    to: input.email,
    replyTo: env.RESEND_REPLY_TO,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (error) {
    throw new Error(`Resend rejected the email: ${error.message}`);
  }
}
