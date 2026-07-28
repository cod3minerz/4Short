import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { genericOAuth, yandex } from "better-auth/plugins/generic-oauth";
import { createDb } from "../../../../db/index.js";
import * as schema from "../../../../db/schema.js";
import { getEnv } from "../env.js";
import { sendOtpEmail } from "./email.js";

const env = getEnv();
const oauthConfig = env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET
  ? [yandex({ clientId: env.YANDEX_CLIENT_ID, clientSecret: env.YANDEX_CLIENT_SECRET })]
  : [];

export const auth = betterAuth({
  appName: "4Short",
  baseURL: env.API_PUBLIC_URL,
  basePath: "/v1/auth",
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  advanced: {
    database: { generateId: "uuid" },
  },
  database: drizzleAdapter(createDb(), {
    provider: "pg",
    schema,
    usePlural: true,
    transaction: true,
  }),
  emailAndPassword: { enabled: false },
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
      sendVerificationOTP: sendOtpEmail,
    }),
    ...(oauthConfig.length ? [genericOAuth({ config: oauthConfig })] : []),
  ],
});
