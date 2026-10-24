import { closeDb } from "../../../db/index.js";
import { buildApp } from "./app.js";
import { getEnv } from "./env.js";
import { reconcilePendingPipelineAdvances } from "./services/pipeline-reconciliation.js";
import { requeueExpiredLeases } from "./services/queue.js";

const env = getEnv();
const app = await buildApp();

const leaseSweep = setInterval(() => {
  void requeueExpiredLeases(app.db).catch((error) => app.log.error({ err: error }, "lease sweep failed"));
}, 30_000);
leaseSweep.unref();

const pipelineSweep = setInterval(() => {
  void reconcilePendingPipelineAdvances(app.db, {
    onError: (jobId, error) => app.log.error({ err: error, jobId }, "pipeline reconciliation failed"),
  }).catch((error) => app.log.error({ err: error }, "pipeline sweep failed"));
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
