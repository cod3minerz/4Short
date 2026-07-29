import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["require", "verify-full", "disable"]).default("require"),
  DATABASE_SSL_ROOT_CERT: z.string().optional(),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(30).default(10),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4100"),
  BETTER_AUTH_SECRET: z.string().min(32),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  YANDEX_CLIENT_ID: z.string().optional(),
  YANDEX_CLIENT_SECRET: z.string().optional(),
  UNISENDER_GO_API_KEY: z.string().optional(),
  UNISENDER_GO_FROM_EMAIL: z.string().email().optional(),
  UNISENDER_GO_FROM_NAME: z.string().default("4Short"),
  S3_ENDPOINT: z.string().url().default("https://s3.twcstorage.ru"),
  S3_REGION: z.string().default("ru-1"),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  S3_SERVER_SIDE_ENCRYPTION: z.enum(["AES256", "none"]).default("none"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1).optional(),
  S3_RAW_BUCKET: z.string().default("4short-raw"),
  S3_PROXY_BUCKET: z.string().default("4short-proxy"),
  S3_DERIVED_BUCKET: z.string().default("4short-derived"),
  S3_ASSETS_BUCKET: z.string().default("4short-brand-assets"),
  S3_RAW_PREFIX: z.string().default("raw"),
  S3_PROXY_PREFIX: z.string().default("proxy"),
  S3_DERIVED_PREFIX: z.string().default("derived"),
  S3_ASSETS_PREFIX: z.string().default("assets"),
  WORKER_API_TOKEN: z.string().min(32),
  TBANK_TERMINAL_KEY: z.string().optional(),
  TBANK_PASSWORD: z.string().optional(),
  TBANK_API_URL: z.string().url().default("https://securepay.tinkoff.ru/v2"),
  PAYMENT_RETURN_URL: z.string().url().default("http://localhost:3000/dashboard/billing"),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  RATE_LIMIT_MAX: z.coerce.number().int().min(30).max(10_000).default(240),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type ControlApiEnv = z.infer<typeof environmentSchema>;

let cached: ControlApiEnv | undefined;

export function getEnv(): ControlApiEnv {
  cached ??= environmentSchema.parse(process.env);
  return cached;
}
