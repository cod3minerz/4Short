import { and, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  enqueueJobSchema,
  jobCompletionSchema,
  jobFailureSchema,
  workerClaimSchema,
  workerHeartbeatSchema,
  workerRegistrationSchema,
} from "../../../../packages/contracts/src/index.js";
import { jobEvents, jobs, workerLeases } from "../../../../db/schema.js";
import { getEnv } from "../env.js";
import { getIdempotencyKey } from "../lib/http.js";
import {
  completeJob,
  claimNextJob,
  failJob,
  heartbeatJob,
  markAdvancePending,
  markJobAdvanced,
} from "../services/queue.js";
import { advancePipeline } from "../services/pipeline.js";

function requireWorker(request: FastifyRequest) {
  const token = request.headers["x-worker-token"];
  if (token !== getEnv().WORKER_API_TOKEN) {
    throw request.server.httpErrors.unauthorized("Invalid worker token");
  }
}

export async function jobRoutes(app: FastifyInstance) {
  app.post("/v1/jobs", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const body = enqueueJobSchema.parse(request.body);
    const key = getIdempotencyKey(request);
    const { workspaceId } = request.authContext!;
    const [job] = await app.db.insert(jobs).values({
      workspaceId,
      projectId: body.projectId,
      clipId: body.clipId,
      type: body.type,
      class: body.class,
      payload: body.payload,
      artifactHash: body.artifactHash,
      estimatedCost: String(body.estimatedCost),
      idempotencyKey: key,
    }).onConflictDoUpdate({
      target: [jobs.workspaceId, jobs.idempotencyKey],
      set: { updatedAt: new Date() },
    }).returning();
    return reply.code(201).send(job);
  });

  app.post("/v1/internal/workers/register", { preHandler: requireWorker }, async (request) => {
    const body = workerRegistrationSchema.parse(request.body);
    const [worker] = await app.db.insert(workerLeases).values({
      workerId: body.workerId,
      version: body.version,
      capabilities: body.capabilities,
      metadata: body.metadata,
      lastHeartbeatAt: new Date(),
    }).onConflictDoUpdate({
      target: workerLeases.workerId,
      set: {
        version: body.version,
        capabilities: body.capabilities,
        metadata: body.metadata,
        lastHeartbeatAt: new Date(),
      },
    }).returning();
    return worker;
  });

  app.post("/v1/internal/jobs/claim", { preHandler: requireWorker }, async (request, reply) => {
    const body = workerClaimSchema.parse(request.body);
    const job = await claimNextJob({ db: app.db, ...body });
    return job ? job : reply.code(204).send();
  });

  app.post("/v1/internal/jobs/:jobId/heartbeat", { preHandler: requireWorker }, async (request) => {
    const body = workerHeartbeatSchema.parse(request.body);
    const { jobId } = request.params as { jobId: string };
    const job = await heartbeatJob({ db: app.db, jobId, ...body });
    if (!job) throw app.httpErrors.conflict("Job lease is no longer owned by this worker");
    return job;
  });

  app.post("/v1/internal/jobs/:jobId/complete", { preHandler: requireWorker }, async (request) => {
    const body = jobCompletionSchema.parse(request.body);
    const { jobId } = request.params as { jobId: string };
    const job = await completeJob({ db: app.db, jobId, ...body });
    if (!job) throw app.httpErrors.conflict("Job lease is no longer owned by this worker");
    try {
      await advancePipeline(app.db, job);
      await markJobAdvanced(app.db, job.id);
    } catch (error) {
      request.log.error({ err: error, jobId: job.id }, "pipeline advance deferred");
      await markAdvancePending(app.db, job.id, error);
    }
    return job;
  });

  app.post("/v1/internal/jobs/:jobId/fail", { preHandler: requireWorker }, async (request) => {
    const body = jobFailureSchema.parse(request.body);
    const { jobId } = request.params as { jobId: string };
    const job = await failJob({
      db: app.db,
      jobId,
      workerId: body.workerId,
      retryable: body.retryable,
      error: { code: body.code, message: body.message, details: body.details },
    });
    if (!job) throw app.httpErrors.conflict("Job lease is no longer owned by this worker");
    return job;
  });

  app.get("/v1/events", { preHandler: app.requireWorkspace }, async (request, reply) => {
    const { workspaceId } = request.authContext!;
    const lastEventId = Number(request.headers["last-event-id"] ?? 0);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let cursor = Number.isFinite(lastEventId) ? lastEventId : 0;
    const send = async () => {
      // The cursor has to be part of the query, not a filter applied after
      // LIMIT: selecting the oldest 100 rows and then skipping the ones
      // already sent meant that past 100 events per workspace the batch was
      // always fully consumed and no new event ever reached the client.
      const events = await app.db.select()
        .from(jobEvents)
        .where(and(eq(jobEvents.workspaceId, workspaceId), gt(jobEvents.id, cursor)))
        .orderBy(jobEvents.id)
        .limit(100);
      for (const event of events) {
        cursor = event.id;
        reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      }
    };

    await send();
    const timer = setInterval(() => void send(), 2_000);
    const ping = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
    request.raw.on("close", () => {
      clearInterval(timer);
      clearInterval(ping);
      reply.raw.end();
    });
  });
}
