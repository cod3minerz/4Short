import type { FastifyInstance } from "fastify";
import { desc } from "drizzle-orm";
import { engineReleases, workerLeases } from "../../../../db/schema.js";
import { parseWorkerCapability } from "../services/hve-scheduler.js";

/**
 * Capability truth source for future editor controls. A client must lock a
 * control when it is absent here; it must never imply unsupported HVE work.
 */
export async function engineRoutes(app: FastifyInstance) {
  app.get("/v1/engine/capabilities", { preHandler: app.requireWorkspace }, async () => {
    const [release] = await app.db.select().from(engineReleases)
      .orderBy(desc(engineReleases.createdAt))
      .limit(1);
    const workers = await app.db.select().from(workerLeases);
    const capabilities = workers
      .map((worker) => ({ workerId: worker.workerId, capability: parseWorkerCapability(worker.capabilities) }))
      .filter((worker): worker is { workerId: string; capability: NonNullable<ReturnType<typeof parseWorkerCapability>> } => worker.capability !== null);

    return {
      contractVersion: 2,
      release: release ? {
        engineVersion: release.engineVersion,
        plannerVersion: release.plannerVersion,
        rendererVersion: release.rendererVersion,
        status: release.status,
      } : null,
      workers: capabilities.map(({ workerId, capability }) => ({
        workerId,
        engineVersion: capability.engineVersion,
        jobClasses: capability.jobClasses,
        memoryBytes: capability.memoryBytes,
        scratchFreeBytes: capability.scratchFreeBytes,
      })),
      // HVE-0/HVE-1 intentionally exposes only what the current worker can
      // execute. Perception and compositor controls remain unavailable.
      features: {
        v2Documents: true,
        resourceAdmission: true,
        timeMapPlanner: false,
        generalizedCompositor: false,
        activeSpeakerDirector: false,
        screenGameplayLayout: false,
        editorDrafts: false,
      },
    };
  });
}
