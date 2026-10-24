import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvironment } from "../../services/control-api/src/env.js";

const validProductionEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://narezai_app:secret@managed.example:5432/narezai",
  DATABASE_SSL: "verify-full",
  DATABASE_SSL_ROOT_CERT: "/etc/ssl/certs/narezai-managed-postgres.crt",
  WEB_ORIGIN: "https://narezai.com",
  API_PUBLIC_URL: "https://api.narezai.com",
  BETTER_AUTH_SECRET: "a".repeat(32),
  S3_ENDPOINT: "https://s3.twcstorage.ru",
  S3_ACCESS_KEY_ID: "narezai-access-key",
  S3_SECRET_ACCESS_KEY: "narezai-secret-key",
  S3_BUCKET: "narezai-s3",
  WORKER_API_TOKEN: "w".repeat(32),
});

test("production environment requires verified database TLS and its pinned certificate", () => {
  const withoutVerifiedTls = validProductionEnvironment();
  withoutVerifiedTls.DATABASE_SSL = "require";
  assert.throws(() => parseEnvironment(withoutVerifiedTls), /DATABASE_SSL must be verify-full/);

  const withoutCertificate = validProductionEnvironment();
  delete withoutCertificate.DATABASE_SSL_ROOT_CERT;
  assert.throws(() => parseEnvironment(withoutCertificate), /DATABASE_SSL_ROOT_CERT is required/);
});

test("production environment requires an explicit private S3 bucket and HTTPS endpoints", () => {
  const withoutBucket = validProductionEnvironment();
  delete withoutBucket.S3_BUCKET;
  assert.throws(() => parseEnvironment(withoutBucket), /S3_BUCKET must explicitly name/);

  const insecureApi = validProductionEnvironment();
  insecureApi.API_PUBLIC_URL = "http://api.narezai.com";
  assert.throws(() => parseEnvironment(insecureApi), /API_PUBLIC_URL must use HTTPS/);
});

test("non-production environments retain local HTTP and legacy bucket defaults", () => {
  const parsed = parseEnvironment({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/narezai",
    BETTER_AUTH_SECRET: "a".repeat(32),
    S3_ACCESS_KEY_ID: "local-access-key",
    S3_SECRET_ACCESS_KEY: "local-secret-key",
    WORKER_API_TOKEN: "w".repeat(32),
  });

  assert.equal(parsed.WEB_ORIGIN, "http://localhost:3000");
  assert.equal(parsed.S3_RAW_BUCKET, "4short-raw");
});
