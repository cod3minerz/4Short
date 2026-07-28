import { getEnv } from "../env.js";

export async function sendOtpEmail(input: {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
}) {
  const env = getEnv();
  if (!env.UNISENDER_GO_API_KEY || !env.UNISENDER_GO_FROM_EMAIL) {
    if (env.NODE_ENV === "development") {
      console.info(`[auth] OTP for ${input.email}: ${input.otp}`);
      return;
    }
    throw new Error("Email provider is not configured");
  }

  const response = await fetch("https://go1.unisender.ru/ru/transactional/api/v1/email/send.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": env.UNISENDER_GO_API_KEY,
    },
    body: JSON.stringify({
      message: {
        recipients: [{ email: input.email }],
        body: {
          html: `<p>Код входа в 4Short:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${input.otp}</p><p>Код действует 10 минут.</p>`,
          plaintext: `Код входа в 4Short: ${input.otp}. Код действует 10 минут.`,
        },
        subject: "Код входа в 4Short",
        from_email: env.UNISENDER_GO_FROM_EMAIL,
        from_name: env.UNISENDER_GO_FROM_NAME,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Unisender Go rejected the email: ${response.status}`);
  }
}
