import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { genericOAuth, yandex } from "better-auth/plugins/generic-oauth";
import { createDb } from "../../../../db/index.js";
import * as schema from "../../../../db/schema.js";
import { getEnv, getTrustedWebOrigins } from "../env.js";
import { sendOtpEmail } from "./email.js";

const env = getEnv();
const oauthConfig = env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET
  ? [yandex({ clientId: env.YANDEX_CLIENT_ID, clientSecret: env.YANDEX_CLIENT_SECRET })]
  : [];

export const auth = betterAuth({
  appName: "Hashpix",
  baseURL: env.API_PUBLIC_URL,
  basePath: "/v1/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: getTrustedWebOrigins(env),
  advanced: {
    database: { generateId: "uuid" },
  },
  database: drizzleAdapter(createDb(), {
    provider: "pg",
    schema,
    usePlural: true,
    transaction: true,
  }),
  emailAndPassword: {
    enabled: true,
    // A password is never enough for a new account: the session is created
    // only after a short-lived, hashed email OTP has been verified.
    requireEmailVerification: true,
    autoSignIn: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  plugins: [
    emailOTP({
      expiresIn: 600,
      otpLength: 6,
      allowedAttempts: 5,
      storeOTP: "hashed",
      overrideDefaultEmailVerification: true,
      rateLimit: { window: 60, max: 3 },
      sendVerificationOTP: sendOtpEmail,
    }),
    ...(oauthConfig.length ? [genericOAuth({ config: oauthConfig })] : []),
  ],
});
