import { closeDb } from "../../../db/index.js";
import { buildApp } from "./app.js";
import { getEnv } from "./env.js";
import { and, asc, eq } from "drizzle-orm";
import { jobs } from "../../../db/schema.js";
import { advancePipeline } from "./services/pipeline.js";
import {
  markAdvancePending,
  markJobAdvanced,
  requeueExpiredLeases,
} from "./services/queue.js";

const env = getEnv();
const app = await buildApp();

const leaseSweep = setInterval(() => {
  void requeueExpiredLeases(app.db).catch((error) => app.log.error({ err: error }, "lease sweep failed"));
}, 30_000);
leaseSweep.unref();

const pipelineSweep = setInterval(async () => {
  const pending = await app.db.select().from(jobs)
    .where(and(eq(jobs.status, "succeeded"), eq(jobs.checkpoint, "worker_complete")))
    .orderBy(asc(jobs.completedAt))
    .limit(20);
  for (const job of pending) {
    try {
      await advancePipeline(app.db, job);
      await markJobAdvanced(app.db, job.id);
    } catch (error) {
      await markAdvancePending(app.db, job.id, error);
      app.log.error({ err: error, jobId: job.id }, "pipeline reconciliation failed");
    }
  }
}, 15_000);
pipelineSweep.unref();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  clearInterval(leaseSweep);
  clearInterval(pipelineSweep);
  await app.close();
  await closeDb();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.HOST, port: env.PORT });
