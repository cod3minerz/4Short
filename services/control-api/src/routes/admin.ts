import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  adminListQuerySchema,
  adminMinuteAdjustmentSchema,
  adminUserRoleUpdateSchema,
  adminUserStatusUpdateSchema,
  adminWorkspacePlanUpdateSchema,
} from "../../../../packages/contracts/src/index.js";
import {
  auditEvents,
  jobAttempts,
  jobs,
  minuteBuckets,
  minuteTransactions,
  payments,
  plans,
  projects,
  subscriptions,
  users,
  workerLeases,
  workspaceMembers,
  workspaces,
} from "../../../../db/schema.js";
import { getIdempotencyKey } from "../lib/http.js";
import { assertAdminPermission } from "../plugins/context.js";
import { getMinuteBalance } from "../services/minutes.js";
import { evaluateHveEtaCoverage, readHveEtaPredictionSnapshot, type HveEtaCoverageObservation } from "../services/hve-eta-coverage.js";

type AuditInput = {
  workspaceId?: string | null;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
};

async function writeAudit(app: FastifyInstance, input: AuditInput) {
  await app.db.insert(auditEvents).values({
    workspaceId: input.workspaceId ?? null,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
  });
}

function pagination(query: unknown) {
  const parsed = adminListQuerySchema.parse(query);
  return { ...parsed, offset: (parsed.page - 1) * parsed.limit };
}

function adminActor(app: FastifyInstance, request: Parameters<typeof assertAdminPermission>[0]) {
  const actor = request.platformActor;
  if (!actor) throw app.httpErrors.unauthorized("Admin context missing");
  return actor;
}

export async function adminRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: app.requirePlatformAdmin };

  app.get("/v1/admin/me", adminOnly, async (request) => {
    const actor = adminActor(app, request);
    return {
      id: actor.userId,
      email: actor.email,
      role: actor.role,
      persistedRole: actor.persistedRole,
      bootstrap: actor.bootstrap,
      permissions: {
        usersWrite: ["admin", "super_admin"].includes(actor.role),
        rolesWrite: actor.role === "super_admin",
        workspacesWrite: ["admin", "super_admin"].includes(actor.role),
        minutesWrite: ["admin", "super_admin"].includes(actor.role),
        jobsWrite: ["admin", "super_admin"].includes(actor.role),
      },
    };
  });

  app.get("/v1/admin/overview", adminOnly, async (request) => {
    assertAdminPermission(request, "platform:read");
    const [
      [userCount],
      [workspaceCount],
      [projectSummary],
      [jobSummary],
      [revenue],
      workers,
    ] = await Promise.all([
      app.db.select({ value: count() }).from(users),
      app.db.select({ value: count() }).from(workspaces),
      app.db.select({
        total: count(),
        active: sql<number>`count(*) filter (where ${projects.status} not in ('ready', 'failed', 'archived'))::int`,
        failed: sql<number>`count(*) filter (where ${projects.status} = 'failed')::int`,
      }).from(projects),
      app.db.select({
        queued: sql<number>`count(*) filter (where ${jobs.status} = 'queued')::int`,
        running: sql<number>`count(*) filter (where ${jobs.status} in ('leased', 'waiting_provider'))::int`,
        failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')::int`,
      }).from(jobs),
      app.db.select({
        kopecks: sql<number>`coalesce(sum(${payments.amountKopecks}) filter (where ${payments.status} = 'succeeded'), 0)::bigint`,
      }).from(payments),
      app.db.select().from(workerLeases).orderBy(desc(workerLeases.lastHeartbeatAt)),
    ]);
    return {
      users: Number(userCount?.value ?? 0),
      workspaces: Number(workspaceCount?.value ?? 0),
      projects: {
        total: Number(projectSummary?.total ?? 0),
        active: Number(projectSummary?.active ?? 0),
        failed: Number(projectSummary?.failed ?? 0),
      },
      jobs: {
        queued: Number(jobSummary?.queued ?? 0),
        running: Number(jobSummary?.running ?? 0),
        failed: Number(jobSummary?.failed ?? 0),
      },
      revenueKopecks: Number(revenue?.kopecks ?? 0),
      workers: workers.map((worker) => ({
        id: worker.workerId,
        version: worker.version,
        lastHeartbeatAt: worker.lastHeartbeatAt,
        online: Date.now() - worker.lastHeartbeatAt.getTime() < 90_000,
        capabilities: worker.capabilities,
      })),
    };
  });

  /**
   * Operational G7 telemetry. It exposes only aggregate calibration facts;
   * no source URL, project title, transcript or user prompt participates in
   * the ETA coverage evidence.
   */
  app.get("/v1/admin/hve/eta-coverage", adminOnly, async (request) => {
    assertAdminPermission(request, "platform:read");
    const query = request.query as { runtimeFingerprint?: string; days?: string };
    const runtimeFingerprint = query.runtimeFingerprint?.toLowerCase();
    if (!runtimeFingerprint || !/^[a-f0-9]{64}$/.test(runtimeFingerprint)) {
      throw app.httpErrors.badRequest("runtimeFingerprint must be a SHA-256 value");
    }
    const parsedDays = Number(query.days ?? 30);
    const days = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 90 ? parsedDays : null;
    if (!days) throw app.httpErrors.badRequest("days must be an integer from 1 to 90");
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
    const rows = await app.db.select({
      attemptId: jobAttempts.id,
      metrics: jobAttempts.metrics,
    }).from(jobAttempts)
      .innerJoin(jobs, eq(jobs.id, jobAttempts.jobId))
      .where(and(eq(jobAttempts.status, "succeeded"), gt(jobAttempts.finishedAt, since)))
      .orderBy(desc(jobAttempts.finishedAt))
      .limit(5_000);
    const observations: HveEtaCoverageObservation[] = rows.flatMap((row) => {
      const metrics = row.metrics as Record<string, unknown>;
      const prediction = readHveEtaPredictionSnapshot(metrics.hveEtaPrediction);
      const actualWallSeconds = Number(metrics.wallSeconds);
      return prediction && Number.isFinite(actualWallSeconds) && actualWallSeconds > 0
        ? [{ attemptId: row.attemptId, actualWallSeconds, prediction }]
        : [];
    });
    return {
      periodDays: days,
      since: since.toISOString(),
      ...evaluateHveEtaCoverage({ runtimeFingerprint, observations }),
    };
  });

  app.get("/v1/admin/users", adminOnly, async (request) => {
    assertAdminPermission(request, "platform:read");
    const { search, page, limit, offset } = pagination(request.query);
    const condition = search
      ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`))
      : undefined;
    const [items, [total]] = await Promise.all([
      app.db.select().from(users)
        .where(condition)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
      app.db.select({ value: count() }).from(users).where(condition),
    ]);
    const ids = items.map((user) => user.id);
    const memberships = ids.length
      ? await app.db.select({
          userId: workspaceMembers.userId,
          workspaceId: workspaces.id,
          workspaceName: workspaces.name,
          workspaceRole: workspaceMembers.role,
          planCode: workspaces.planCode,
        }).from(workspaceMembers)
          .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
          .where(inArray(workspaceMembers.userId, ids))
      : [];
    return {
      items: items.map((user) => ({
        ...user,
        memberships: memberships.filter((membership) => membership.userId === user.id),
      })),
      page,
      limit,
      total: Number(total?.value ?? 0),
    };
  });

  app.put("/v1/admin/users/:userId/role", adminOnly, async (request) => {
    const actor = assertAdminPermission(request, "roles:write");
    const { userId } = request.params as { userId: string };
    const body = adminUserRoleUpdateSchema.parse(request.body);
    if (userId === actor.userId) throw app.httpErrors.conflict("Нельзя изменить собственную роль");
    const [target] = await app.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw app.httpErrors.notFound("User not found");
    const [updated] = await app.db.update(users)
      .set({ platformRole: body.role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    await writeAudit(app, {
      actorUserId: actor.userId,
      action: "admin.user.role_changed",
      entityType: "user",
      entityId: userId,
      metadata: { from: target.platformRole, to: body.role },
    });
    return updated;
  });

  app.put("/v1/admin/users/:userId/status", adminOnly, async (request) => {
    const actor = assertAdminPermission(request, "users:write");
    const { userId } = request.params as { userId: string };
    const body = adminUserStatusUpdateSchema.parse(request.body);
    if (userId === actor.userId) throw app.httpErrors.conflict("Нельзя заблокировать собственный аккаунт");
    const [target] = await app.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw app.httpErrors.notFound("User not found");
    if (actor.role !== "super_admin" && ["admin", "super_admin"].includes(target.platformRole)) {
      throw app.httpErrors.forbidden("Только super admin может управлять администраторами");
    }
    const [updated] = await app.db.update(users).set({
      status: body.status,
      suspendedAt: body.status === "suspended" ? new Date() : null,
      suspensionReason: body.status === "suspended" ? body.reason : null,
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning();
    await writeAudit(app, {
      actorUserId: actor.userId,
      action: body.status === "suspended" ? "admin.user.suspended" : "admin.user.reactivated",
      entityType: "user",
      entityId: userId,
      metadata: { reason: body.reason ?? null, previousStatus: target.status },
    });
    return updated;
  });

  app.get("/v1/admin/workspaces", adminOnly, async (request) => {
    assertAdminPermission(request, "platform:read");
    const { search, page, limit, offset } = pagination(request.query);
    const condition = search
      ? or(ilike(workspaces.name, `%${search}%`), ilike(workspaces.slug, `%${search}%`))
      : undefined;
    const [items, [total]] = await Promise.all([
      app.db.select({
        workspace: workspaces,
        memberCount: sql<number>`count(distinct ${workspaceMembers.userId})::int`,
        projectCount: sql<number>`count(distinct ${projects.id})::int`,
        availableSeconds: sql<number>`coalesce(max(balance.available_seconds), 0)::bigint`,
      }).from(workspaces)
        .leftJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
        .leftJoin(projects, eq(projects.workspaceId, workspaces.id))
        .leftJoin(
          sql`(
            select workspace_id, sum(available_seconds)::bigint as available_seconds
            from minute_buckets
            where expires_at is null or expires_at > now()
            group by workspace_id
          ) balance`,
          sql`balance.workspace_id = ${workspaces.id}`,
        )
        .where(condition)
        .groupBy(workspaces.id)
        .orderBy(desc(workspaces.createdAt))
        .limit(limit)
        .offset(offset),
      app.db.select({ value: count() }).from(workspaces).where(condition),
    ]);
    return {
      items: items.map((item) => ({
        ...item.workspace,
        memberCount: Number(item.memberCount),
        projectCount: Number(item.projectCount),
        availableSeconds: Number(item.availableSeconds),
      })),
      page,
      limit,
      total: Number(total?.value ?? 0),
    };
  });

  app.put("/v1/admin/workspaces/:workspaceId/plan", adminOnly, async (request) => {
    const actor = assertAdminPermission(request, "workspaces:write");
    const { workspaceId } = request.params as { workspaceId: string };
    const body = adminWorkspacePlanUpdateSchema.parse(request.body);
    const [plan] = await app.db.select().from(plans)
      .where(and(eq(plans.code, body.planCode), eq(plans.isActive, true)))
      .limit(1);
    if (!plan) throw app.httpErrors.badRequest("Plan is not active");
    const [current] = await app.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!current) throw app.httpErrors.notFound("Workspace not found");
    const [updated] = await app.db.update(workspaces)
      .set({ planCode: body.planCode, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    await writeAudit(app, {
      workspaceId,
      actorUserId: actor.userId,
      action: "admin.workspace.plan_changed",
      entityType: "workspace",
      entityId: workspaceId,
      metadata: { from: current.planCode, to: body.planCode },
    });
    return updated;
  });

  app.post("/v1/admin/workspaces/:workspaceId/minutes/adjust", adminOnly, async (request) => {
    const actor = assertAdminPermission(request, "minutes:write");
    const { workspaceId } = request.params as { workspaceId: string };
    const body = adminMinuteAdjustmentSchema.parse(request.body);
    const key = getIdempotencyKey(request);
    const existing = await app.db.select().from(minuteTransactions)
      .where(and(
        eq(minuteTransactions.workspaceId, workspaceId),
        eq(minuteTransactions.idempotencyKey, key),
      ))
      .limit(1);
    if (existing[0]) return existing[0];

    const balance = await getMinuteBalance(app.db, workspaceId);
    if (body.seconds < 0 && balance.availableSeconds < Math.abs(body.seconds)) {
      throw app.httpErrors.conflict("Недостаточно минут для списания");
    }

    const transaction = await app.db.transaction(async (tx) => {
      if (body.seconds > 0) {
        const [bucket] = await tx.insert(minuteBuckets).values({
          workspaceId,
          source: "admin_adjustment",
          grantedSeconds: body.seconds,
          availableSeconds: body.seconds,
          priority: 40,
        }).returning();
        const [entry] = await tx.insert(minuteTransactions).values({
          workspaceId,
          bucketId: bucket.id,
          kind: "adjustment",
          seconds: body.seconds,
          balanceAfterSeconds: balance.availableSeconds + body.seconds,
          reason: body.reason,
          idempotencyKey: key,
          metadata: { actorUserId: actor.userId },
        }).returning();
        return entry;
      }

      const buckets = await tx.select().from(minuteBuckets)
        .where(and(
          eq(minuteBuckets.workspaceId, workspaceId),
          gt(minuteBuckets.availableSeconds, 0),
          or(isNull(minuteBuckets.expiresAt), gt(minuteBuckets.expiresAt, new Date())),
        ))
        .orderBy(asc(minuteBuckets.priority), asc(minuteBuckets.expiresAt))
        .for("update");
      let remaining = Math.abs(body.seconds);
      for (const bucket of buckets) {
        if (!remaining) break;
        const spend = Math.min(remaining, bucket.availableSeconds);
        remaining -= spend;
        await tx.update(minuteBuckets).set({
          availableSeconds: bucket.availableSeconds - spend,
          updatedAt: new Date(),
        }).where(eq(minuteBuckets.id, bucket.id));
      }
      const [entry] = await tx.insert(minuteTransactions).values({
        workspaceId,
        kind: "adjustment",
        seconds: body.seconds,
        balanceAfterSeconds: balance.availableSeconds + body.seconds,
        reason: body.reason,
        idempotencyKey: key,
        metadata: { actorUserId: actor.userId },
      }).returning();
      return entry;
    });

    await writeAudit(app, {
      workspaceId,
      actorUserId: actor.userId,
      action: "admin.workspace.minutes_adjusted",
      entityType: "workspace",
      entityId: workspaceId,
      metadata: { seconds: body.seconds, reason: body.reason, transactionId: transaction.id },
    });
    return transaction;
  });

  app.get("/v1/admin/jobs", adminOnly, async (request) => {
    assertAdminPermission(request, "platform:read");
    const { search, page, limit, offset } = pagination(request.query);
    const condition = search
      ? or(
          ilike(jobs.type, `%${search}%`),
          ilike(jobs.status, `%${search}%`),
          ilike(workspaces.name, `%${search}%`),
          ilike(projects.title, `%${search}%`),
        )
      : undefined;
    const [items, [total]] = await Promise.all([
      app.db.select({
        job: jobs,
        workspaceName: workspaces.name,
        projectTitle: projects.title,
      }).from(jobs)
        .innerJoin(workspaces, eq(workspaces.id, jobs.workspaceId))
        .leftJoin(projects, eq(projects.id, jobs.projectId))
        .where(condition)
        .orderBy(desc(jobs.createdAt))
        .limit(limit)
        .offset(offset),
      app.db.select({ value: count() }).from(jobs)
        .innerJoin(workspaces, eq(workspaces.id, jobs.workspaceId))
        .leftJoin(projects, eq(projects.id, jobs.projectId))
        .where(condition),
    ]);
    return {
      items: items.map((item) => ({
        ...item.job,
        workspaceName: item.workspaceName,
        projectTitle: item.projectTitle,
      })),
      page,
      limit,
      total: Number(total?.value ?? 0),
    };
  });

  app.post("/v1/admin/jobs/:jobId/:action", adminOnly, async (request) => {
    const actor = assertAdminPermission(request, "jobs:write");
    const { jobId, action } = request.params as { jobId: string; action: string };
    if (!["retry", "cancel"].includes(action)) throw app.httpErrors.notFound("Unknown action");
    const [current] = await app.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!current) throw app.httpErrors.notFound("Job not found");
    if (action === "retry" && !["failed", "cancelled"].includes(current.status)) {
      throw app.httpErrors.conflict("Повторить можно только завершённую с ошибкой или отменённую задачу");
    }
    if (action === "cancel" && !["queued", "leased", "waiting_provider"].includes(current.status)) {
      throw app.httpErrors.conflict("Эту задачу уже нельзя отменить");
    }
    const [updated] = await app.db.update(jobs).set(action === "retry" ? {
      status: "queued",
      availableAt: new Date(),
      completedAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      error: null,
      updatedAt: new Date(),
    } : {
      status: "cancelled",
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    }).where(eq(jobs.id, jobId)).returning();
    await writeAudit(app, {
      workspaceId: current.workspaceId,
      actorUserId: actor.userId,
      action: action === "retry" ? "admin.job.retried" : "admin.job.cancelled",
      entityType: "job",
      entityId: jobId,
      metadata: { previousStatus: current.status },
    });
    return updated;
  });

  app.get("/v1/admin/audit", adminOnly, async (request) => {
    assertAdminPermission(request, "platform:read");
    const { search, page, limit, offset } = pagination(request.query);
    const condition = search
      ? or(
          ilike(auditEvents.action, `%${search}%`),
          ilike(auditEvents.entityType, `%${search}%`),
          ilike(auditEvents.entityId, `%${search}%`),
          ilike(users.email, `%${search}%`),
        )
      : undefined;
    const [items, [total]] = await Promise.all([
      app.db.select({
        event: auditEvents,
        actorEmail: users.email,
      }).from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(condition)
        .orderBy(desc(auditEvents.createdAt))
        .limit(limit)
        .offset(offset),
      app.db.select({ value: count() }).from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(condition),
    ]);
    return {
      items: items.map((item) => ({ ...item.event, actorEmail: item.actorEmail })),
      page,
      limit,
      total: Number(total?.value ?? 0),
    };
  });

  app.get("/v1/admin/subscriptions", adminOnly, async (request) => {
    assertAdminPermission(request, "platform:read");
    return app.db.select({
      subscription: subscriptions,
      workspaceName: workspaces.name,
    }).from(subscriptions)
      .innerJoin(workspaces, eq(workspaces.id, subscriptions.workspaceId))
      .orderBy(desc(subscriptions.updatedAt))
      .limit(100);
  });
}
