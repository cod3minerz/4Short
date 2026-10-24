import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import test from "node:test";
import { closeDb, createDb } from "../../db/index.js";
import { clipVersions, clips, jobs, mediaObjects, momentCandidates, momentSearches, projects, projectVersions, sources, stylePresets, styleVersions, users, workspaces } from "../../db/schema.js";
import { defaultStyleConfig } from "../../packages/product-config/src/index.js";
import { advancePipeline } from "../../services/control-api/src/services/pipeline.js";
import { reconcilePendingPipelineAdvances } from "../../services/control-api/src/services/pipeline-reconciliation.js";
import { markFailedClipRender, scheduleProjectRenders, updateProjectRenderStatus } from "../../services/control-api/src/services/project-render.js";
import { markAdvancePending, requeueExpiredLeases } from "../../services/control-api/src/services/queue.js";
import { resolveHveTestDatabaseUrl } from "../support/hve-test-database.js";

const url = resolveHveTestDatabaseUrl();
/** Synthetic completions prove durable orchestration, not media quality or
 * Timeweb throughput. No customer database or object storage is accessed. */
test("100 workspace completions auto-schedule once, freeze settings, and isolate candidates", { skip: !url }, async () => {
  const db = createDb(url);
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  try {
    const fixtures: Array<{ workspace: typeof workspaces.$inferSelect; project: typeof projects.$inferSelect; job: typeof jobs.$inferSelect; version: typeof projectVersions.$inferSelect }> = [];
    for (let index = 0; index < 100; index++) {
      const suffix = randomUUID();
      const [user] = await db.insert(users).values({ email: `opus-${suffix}@example.test` }).returning();
      userIds.push(user.id);
      const [workspace] = await db.insert(workspaces).values({ name: `Opus test ${index}`, slug: `opus-${suffix}`, planCode: "creator" }).returning();
      workspaceIds.push(workspace.id);
      const [media] = await db.insert(mediaObjects).values({ workspaceId: workspace.id, bucket: "test-only", objectKey: suffix, kind: "source", mimeType: "video/mp4", byteSize: 100, expiresAt: new Date(Date.now() + 60_000) }).returning();
      const [source] = await db.insert(sources).values({ workspaceId: workspace.id, kind: "upload", originalMediaId: media.id, fingerprint: "a".repeat(64), durationMs: 60_000 }).returning();
      const [preset] = await db.insert(stylePresets).values({ workspaceId: workspace.id, name: "Test", description: "Synthetic" }).returning();
      const [style] = await db.insert(styleVersions).values({ stylePresetId: preset.id, version: 1, config: defaultStyleConfig, createdBy: user.id }).returning();
      const [project] = await db.insert(projects).values({ workspaceId: workspace.id, createdBy: user.id, title: "Synthetic", status: "finding_moments", sourceId: source.id, styleVersionId: style.id, idempotencyKey: suffix }).returning();
      const [version] = await db.insert(projectVersions).values({ projectId: project.id, version: 1, settings: { processingMode: "auto_render", speechLanguage: "ru", projectOverrides: { export: { ...defaultStyleConfig.export, width: 1920, height: 1080 } } }, createdBy: user.id }).returning();
      const [job] = await db.insert(jobs).values({ workspaceId: workspace.id, projectId: project.id, type: "find_moments", class: "provider", status: "succeeded", payload: { projectVersionId: version.id, settings: { mode: "best" } }, result: { candidates: [{ startMs: 1000, endMs: 11_000, title: "One" }, { startMs: 12_000, endMs: 22_000, title: "Two" }] }, idempotencyKey: `test:${suffix}` }).returning();
      // A later edit must not change already-owned pipeline settings.
      await db.insert(projectVersions).values({ projectId: project.id, version: 2, settings: { processingMode: "review", projectOverrides: { export: { ...defaultStyleConfig.export, width: 1080, height: 1080 } } }, createdBy: user.id });
      await db.update(projects).set({ currentVersion: 2 }).where(eq(projects.id, project.id));
      fixtures.push({ workspace, project, job, version });
    }
    const interrupted = fixtures[0]!.job;
    await db.update(jobs).set({ checkpoint: "worker_complete" }).where(eq(jobs.id, interrupted.id));
    await markAdvancePending(db, interrupted.id, new Error("temporary pipeline persistence failure"));
    const [pendingAdvance] = await db.select().from(jobs).where(eq(jobs.id, interrupted.id));
    assert.equal(pendingAdvance.status, "succeeded");
    assert.equal(pendingAdvance.checkpoint, "worker_complete");
    assert.equal((pendingAdvance.error as { code?: string } | null)?.code, "PIPELINE_ADVANCE_PENDING");
    const reconciliation = await reconcilePendingPipelineAdvances(db, { limit: 20 });
    assert.deepEqual(reconciliation, { examined: 1, advanced: 1, deferred: 0 });
    const [reconciled] = await db.select().from(jobs).where(eq(jobs.id, interrupted.id));
    assert.equal(reconciled.checkpoint, "pipeline_advanced");
    assert.equal(reconciled.error, null);

    // Bound client dispatch too; PostgreSQL's pool is deliberately 10.
    for (let start = 0; start < fixtures.length; start += 10) {
      await Promise.all(fixtures.slice(start, start + 10).flatMap(f => [advancePipeline(db, f.job), advancePipeline(db, f.job)]));
    }
    const [counts] = await db.select({ count: sql<number>`count(*)::int` }).from(clips).where(inArray(clips.projectId, fixtures.map(f => f.project.id)));
    assert.equal(counts.count, 200);
    const renderJobs = await db.select().from(jobs).where(and(inArray(jobs.workspaceId, workspaceIds), eq(jobs.type, "face_track")));
    assert.equal(renderJobs.length, 200);
    for (const job of renderJobs) {
      const fixture = fixtures.find(f => f.project.id === job.projectId)!;
      assert.equal(job.workspaceId, fixture.workspace.id);
      assert.equal(job.payload.projectVersionId, fixture.version.id);
      assert.deepEqual(job.payload.export, { ...defaultStyleConfig.export, width: 1920, height: 1080 });
      assert.deepEqual(job.payload.fontPlan, {
        id: "hve-sans-v1",
        requestedFamily: "HVE Sans",
        rendererFamily: "DejaVu Sans",
        packVersion: "hve-font-pack-dejavu-2.37-1",
      });
      assert.equal(Number(job.queueWeight), 2);
    }
    const first = fixtures[0];
    const fallbackJob = renderJobs.find((job) => job.workspaceId === first.workspace.id)!;
    await db.update(jobs).set({
      status: "succeeded",
      result: { cropTrack: [], faceTracks: [], faceCount: 0, fallback: "static_crop", warnings: ["FACE_NOT_FOUND"] },
    }).where(eq(jobs.id, fallbackJob.id));
    const [completedFallbackJob] = await db.select().from(jobs).where(eq(jobs.id, fallbackJob.id));
    await advancePipeline(db, completedFallbackJob);
    const [fallbackVersion] = await db.select().from(clipVersions).where(eq(clipVersions.clipId, fallbackJob.clipId!));
    assert.deepEqual((fallbackVersion.edl as { faceTracking?: unknown }).faceTracking, {
      mode: "static_crop",
      warnings: ["FACE_NOT_FOUND"],
    });

    const [search] = await db.select().from(momentSearches).where(eq(momentSearches.jobId, first.job.id));
    const candidates = await db.select().from(momentCandidates).where(eq(momentCandidates.searchId, search.id));
    const replay = await scheduleProjectRenders(db, { workspaceId: first.workspace.id, projectId: first.project.id, momentIds: candidates.map(c => c.id) });
    assert.equal(replay.length, 2);
    await assert.rejects(scheduleProjectRenders(db, { workspaceId: fixtures[1].workspace.id, projectId: first.project.id, momentIds: candidates.map(c => c.id) }), /PROJECT_NOT_AVAILABLE/);
    await db.update(projects).set({ archivedAt: new Date(), status: "archived" }).where(eq(projects.id, first.project.id));
    await assert.rejects(scheduleProjectRenders(db, { workspaceId: first.workspace.id, projectId: first.project.id, momentIds: candidates.map(c => c.id) }), /PROJECT_NOT_AVAILABLE/);
  } finally {
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await closeDb();
  }
});

test("terminal render failures update only the current clip version and preserve successful siblings", { skip: !url }, async () => {
  const db = createDb(url);
  const suffix = randomUUID();
  let workspaceId: string | undefined;
  let userId: string | undefined;
  try {
    const [user] = await db.insert(users).values({ email: `opus-failure-${suffix}@example.test` }).returning();
    userId = user.id;
    const [workspace] = await db.insert(workspaces).values({ name: "Render failure test", slug: `opus-failure-${suffix}`, planCode: "creator" }).returning();
    workspaceId = workspace.id;
    const [preset] = await db.insert(stylePresets).values({ workspaceId, name: "Failure test", description: "Synthetic" }).returning();
    const [style] = await db.insert(styleVersions).values({ stylePresetId: preset.id, version: 1, config: defaultStyleConfig, createdBy: user.id }).returning();
    const [project] = await db.insert(projects).values({ workspaceId, createdBy: user.id, title: "Render failures", status: "rendering", styleVersionId: style.id, idempotencyKey: suffix }).returning();
    const [versionA] = await db.insert(clips).values({ projectId: project.id, title: "A", status: "queued" }).returning();
    const [versionB] = await db.insert(clips).values({ projectId: project.id, title: "B", status: "ready" }).returning();
    const [versionC] = await db.insert(clips).values({ projectId: project.id, title: "C", status: "queued", currentVersion: 2 }).returning();
    const [clipVersionA] = await db.insert(clipVersions).values({ clipId: versionA.id, version: 1, edl: {}, renderHash: `${suffix}-a`, createdBy: user.id }).returning();
    await db.insert(clipVersions).values({ clipId: versionB.id, version: 1, edl: {}, renderHash: `${suffix}-b`, createdBy: user.id });
    const [staleVersionC] = await db.insert(clipVersions).values({ clipId: versionC.id, version: 1, edl: {}, renderHash: `${suffix}-c1`, createdBy: user.id }).returning();
    const [currentVersionC] = await db.insert(clipVersions).values({ clipId: versionC.id, version: 2, edl: {}, renderHash: `${suffix}-c2`, createdBy: user.id }).returning();

    const [failedA] = await db.insert(jobs).values({
      workspaceId, projectId: project.id, clipId: versionA.id, type: "render_clip", class: "cpu_heavy", status: "failed",
      payload: { clipVersionId: clipVersionA.id }, idempotencyKey: `${suffix}:failed-a`,
    }).returning();
    await markFailedClipRender(db, failedA);
    const [stillRendering] = await db.select().from(projects).where(eq(projects.id, project.id));
    assert.equal(stillRendering.status, "rendering", "a failed clip must not finish while a sibling is queued");

    const [staleFailure] = await db.insert(jobs).values({
      workspaceId, projectId: project.id, clipId: versionC.id, type: "render_clip", class: "cpu_heavy", status: "failed",
      payload: { clipVersionId: staleVersionC.id }, idempotencyKey: `${suffix}:stale-c`,
    }).returning();
    await markFailedClipRender(db, staleFailure);
    const [unchangedC] = await db.select().from(clips).where(eq(clips.id, versionC.id));
    assert.equal(unchangedC.status, "queued", "a stale failure must not overwrite a newer clip version");

    await db.update(clips).set({ status: "ready" }).where(eq(clips.id, versionC.id));
    const [expiredCurrentC] = await db.insert(jobs).values({
      workspaceId, projectId: project.id, clipId: versionC.id, type: "render_clip", class: "cpu_heavy", status: "leased",
      attemptCount: 3, maxAttempts: 3, leaseOwner: `dead-worker-${suffix}`, leaseExpiresAt: new Date(Date.now() - 60_000),
      payload: { clipVersionId: currentVersionC.id }, idempotencyKey: `${suffix}:expired-current-c`,
    }).returning();
    const expired = await requeueExpiredLeases(db);
    assert.equal(expired.find((job) => job.id === expiredCurrentC.id)?.status, "failed");
    const [partiallyReady] = await db.select().from(projects).where(eq(projects.id, project.id));
    const [failedClip] = await db.select().from(clips).where(eq(clips.id, versionC.id));
    assert.equal(failedClip.status, "failed");
    assert.equal(partiallyReady.status, "partially_ready");
    assert.equal(partiallyReady.errorCode, null, "successful siblings prevent an all-clips-failed project error");

    await db.update(clips).set({ status: "failed" }).where(eq(clips.id, versionB.id));
    await updateProjectRenderStatus(db, project.id);
    const [allFailed] = await db.select().from(projects).where(eq(projects.id, project.id));
    assert.equal(allFailed.status, "failed");
    assert.equal(allFailed.errorCode, "ALL_CLIPS_FAILED");

    await db.update(clips).set({ status: "ready" }).where(eq(clips.id, versionB.id));
    await updateProjectRenderStatus(db, project.id);
    const [recovered] = await db.select().from(projects).where(eq(projects.id, project.id));
    assert.equal(recovered.status, "partially_ready");
    assert.equal(recovered.errorCode, null, "a successful retry clears the all-clips-failed error");

    await db.update(clips).set({ status: "ready" }).where(inArray(clips.id, [versionA.id, versionC.id]));
    await updateProjectRenderStatus(db, project.id);
    const [complete] = await db.select().from(projects).where(eq(projects.id, project.id));
    assert.equal(complete.status, "ready");
    assert.equal(complete.errorMessage, null);

    const [concurrentProject] = await db.insert(projects).values({
      workspaceId,
      createdBy: user.id,
      title: "Concurrent failures",
      status: "rendering",
      styleVersionId: style.id,
      idempotencyKey: `${suffix}:concurrent`,
    }).returning();
    const concurrentClips = await Promise.all(["D", "E"].map(async (title) => {
      const [clip] = await db.insert(clips).values({ projectId: concurrentProject.id, title, status: "queued" }).returning();
      const [version] = await db.insert(clipVersions).values({
        clipId: clip.id,
        version: 1,
        edl: {},
        renderHash: `${suffix}:${title}`,
        createdBy: user.id,
      }).returning();
      const [job] = await db.insert(jobs).values({
        workspaceId: concurrentProject.workspaceId,
        projectId: concurrentProject.id,
        clipId: clip.id,
        type: "render_clip",
        class: "cpu_heavy",
        status: "failed",
        payload: { clipVersionId: version.id },
        idempotencyKey: `${suffix}:concurrent:${title}`,
      }).returning();
      return { clip, job };
    }));
    await Promise.all(concurrentClips.map(({ job }) => markFailedClipRender(db, job)));
    const [concurrentTerminal] = await db.select().from(projects).where(eq(projects.id, concurrentProject.id));
    assert.equal(concurrentTerminal.status, "failed", "concurrent terminal clips cannot strand their project in rendering");
    assert.equal(concurrentTerminal.errorCode, "ALL_CLIPS_FAILED");
  } finally {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await closeDb();
  }
});
