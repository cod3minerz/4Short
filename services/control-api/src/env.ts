import { z } from "zod";

const trustedOriginsSchema = z.string().default("").transform((value, context) => {
  const origins = value.split(",").map((item) => item.trim()).filter(Boolean);
  const normalized: string[] = [];

  for (const origin of origins) {
    try {
      normalized.push(new URL(origin).origin);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `WEB_TRUSTED_ORIGINS contains an invalid URL: ${origin}`,
      });
      return z.NEVER;
    }
  }

  return [...new Set(normalized)];
});

const optionalEmailSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().email().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["require", "verify-full", "disable"]).default("require"),
  DATABASE_SSL_ROOT_CERT: z.string().optional(),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(30).default(10),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  // Canonical origin stays in WEB_ORIGIN. This temporary allowlist keeps the
  // legacy site functional during a public-domain migration without widening
  // CORS or Better Auth to arbitrary origins.
  WEB_TRUSTED_ORIGINS: trustedOriginsSchema,
  API_PUBLIC_URL: z.string().url().default("http://localhost:4100"),
  BETTER_AUTH_SECRET: z.string().min(32),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  YANDEX_CLIENT_ID: z.string().optional(),
  YANDEX_CLIENT_SECRET: z.string().optional(),
  // Optional: enables real duration lookup for the wizard's Step 1 clip-count
  // estimate. Without it, title/thumbnail still work (via oEmbed, no key
  // needed) — duration is simply omitted rather than faked.
  YOUTUBE_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: optionalEmailSchema,
  RESEND_FROM_NAME: z.string().min(1).max(80).default("Narezai"),
  RESEND_REPLY_TO: optionalEmailSchema,
  S3_ENDPOINT: z.string().url().default("https://s3.twcstorage.ru"),
  S3_REGION: z.string().default("ru-1"),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  S3_SERVER_SIDE_ENCRYPTION: z.enum(["AES256", "none"]).default("none"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1).optional(),
  // Legacy per-kind buckets are kept for development/backward compatibility.
  // Production must explicitly configure the single private bucket above.
  S3_RAW_BUCKET: z.string().default("4short-raw"),
  S3_PROXY_BUCKET: z.string().default("4short-proxy"),
  S3_DERIVED_BUCKET: z.string().default("4short-derived"),
  S3_ASSETS_BUCKET: z.string().default("4short-brand-assets"),
  S3_RAW_PREFIX: z.string().default("raw"),
  S3_PROXY_PREFIX: z.string().default("proxy"),
  S3_DERIVED_PREFIX: z.string().default("derived"),
  S3_ASSETS_PREFIX: z.string().default("assets"),
  WORKER_API_TOKEN: z.string().min(32),
  HVE_ENGINE_VERSION: z.string().min(1).max(120).default("hve-0.1"),
  // Must match the immutable model manifest fingerprint advertised by the
  // media worker. An empty value intentionally disables STT dispatch/reuse.
  HVE_STT_MODEL_FINGERPRINT: z.string().regex(/^(?:[a-f0-9]{64})?$/i).default("").transform((value) => value.toLowerCase()),
  // Roll HVE documents out only alongside the typed focus-editor client.
  // Defaulting to false protects existing v1 editor sessions from creating a
  // lossy follow-up version after the pipeline has made a v2 version.
  HVE_INITIAL_DOCUMENTS_ENABLED: z.stringbool().default(false),
  // HVE-G6 is deliberately fail-closed. This may be enabled only after the
  // signed corpus and `hve:verify:layout-director` evidence have been
  // accepted for the exact engine release. Manual, user-verified composites
  // do not depend on this flag.
  HVE_AUTOMATIC_LAYOUT_DIRECTOR_ENABLED: z.stringbool().default(false),
  TBANK_TERMINAL_KEY: z.string().optional(),
  TBANK_PASSWORD: z.string().optional(),
  TBANK_API_URL: z.string().url().default("https://securepay.tinkoff.ru/v2"),
  PAYMENT_RETURN_URL: z.string().url().default("http://localhost:3000/dashboard/billing"),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  RATE_LIMIT_MAX: z.coerce.number().int().min(30).max(10_000).default(240),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
}).superRefine((env, context) => {
  if (env.NODE_ENV !== "production") return;

  const requireHttps = (value: string, field: string) => {
    if (new URL(value).protocol !== "https:") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} must use HTTPS in production`,
      });
    }
  };

  if (env.DATABASE_SSL !== "verify-full") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_SSL"],
      message: "DATABASE_SSL must be verify-full in production",
    });
  }
  if (!env.DATABASE_SSL_ROOT_CERT?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_SSL_ROOT_CERT"],
      message: "DATABASE_SSL_ROOT_CERT is required in production",
    });
  }
  if (!env.S3_BUCKET?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["S3_BUCKET"],
      message: "S3_BUCKET must explicitly name the private production bucket",
    });
  }
  if (!env.RESEND_API_KEY?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["RESEND_API_KEY"],
      message: "RESEND_API_KEY is required for production email sign-in",
    });
  }
  if (!env.RESEND_FROM_EMAIL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["RESEND_FROM_EMAIL"],
      message: "RESEND_FROM_EMAIL must be a verified production sender",
    });
  }

  requireHttps(env.API_PUBLIC_URL, "API_PUBLIC_URL");
  requireHttps(env.WEB_ORIGIN, "WEB_ORIGIN");
  requireHttps(env.S3_ENDPOINT, "S3_ENDPOINT");
});

export type ControlApiEnv = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv = process.env): ControlApiEnv {
  return environmentSchema.parse(input);
}

let cached: ControlApiEnv | undefined;

export function getEnv(): ControlApiEnv {
  cached ??= parseEnvironment();
  return cached;
}

export function getTrustedWebOrigins(env = getEnv()): string[] {
  return [...new Set([new URL(env.WEB_ORIGIN).origin, ...env.WEB_TRUSTED_ORIGINS])];
}
