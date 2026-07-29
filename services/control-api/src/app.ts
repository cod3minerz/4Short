import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { ZodError } from "zod";
import { getEnv } from "./env.js";
import { handleBetterAuth } from "./lib/http.js";
import { databasePlugin } from "./plugins/database.js";
import { contextPlugin } from "./plugins/context.js";
import { billingRoutes } from "./routes/billing.js";
import { adminRoutes } from "./routes/admin.js";
import { jobRoutes } from "./routes/jobs.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { projectRoutes } from "./routes/projects.js";
import { styleRoutes } from "./routes/styles.js";
import { uploadRoutes } from "./routes/uploads.js";

export async function buildApp() {
  const env = getEnv();
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.url",
          "req.body.query",
          "req.body.fileName",
          "res.headers.set-cookie",
        ],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 30_000,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Workspace-Id"],
    exposedHeaders: ["Idempotency-Replayed"],
  });
  await app.register(sensible);
  await app.register(databasePlugin);
  await app.register(contextPlugin);

  app.route({
    method: ["GET", "POST"],
    url: "/v1/auth/*",
    handler: handleBetterAuth,
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    await app.db.execute("select 1");
    return { status: "ready" };
  });

  await app.register(onboardingRoutes);
  await app.register(adminRoutes);
  await app.register(uploadRoutes);
  await app.register(projectRoutes);
  await app.register(styleRoutes);
  await app.register(billingRoutes);
  await app.register(jobRoutes);

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Проверьте введённые данные",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const normalized = error instanceof Error ? error : new Error("INTERNAL_ERROR");
    const statusCode = "statusCode" in normalized && typeof normalized.statusCode === "number"
      ? normalized.statusCode
      : 500;
    if (statusCode >= 500) request.log.error({ err: normalized }, "request failed");
    return reply.code(statusCode).send({
      code: normalized.message || "INTERNAL_ERROR",
      message: statusCode >= 500 ? "Внутренняя ошибка. Задачу можно безопасно повторить." : normalized.message,
    });
  });

  return app;
}
