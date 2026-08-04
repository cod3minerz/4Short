import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);
export const platformRole = pgEnum("platform_role", ["user", "support", "admin", "super_admin"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const projectStatus = pgEnum("project_status", [
  "draft",
  "uploading",
  "importing",
  "probing",
  "transcribing",
  "finding_moments",
  "review_required",
  "rendering",
  "ready",
  "partially_ready",
  "failed",
  "archived",
]);
export const sourceKind = pgEnum("source_kind", ["upload", "youtube"]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "leased",
  // Reserved for a future asynchronous external-provider adapter. Current
  // Faster-Whisper and LLM work stays leased while it executes; a
  // `waiting_provider` row must always have a lease deadline so queue
  // recovery can return it to a runnable state.
  "waiting_provider",
  "succeeded",
  "failed",
  "cancelled",
]);
export const jobClass = pgEnum("job_class", ["io", "provider", "cpu_light", "cpu_medium", "cpu_heavy"]);
export const minuteTransactionKind = pgEnum("minute_transaction_kind", [
  "grant",
  "reserve",
  "commit",
  "release",
  "refund",
  "expire",
  "adjustment",
]);
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "waiting_for_capture",
  "succeeded",
  "cancelled",
  "refunded",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  platformRole: platformRole("platform_role").notNull().default("user"),
  status: userStatus("status").notNull().default("active"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  ...timestamps,
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  index("users_platform_access_idx").on(table.platformRole, table.status),
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  ...timestamps,
}, (table) => [
  uniqueIndex("sessions_token_unique").on(table.token),
  index("sessions_user_idx").on(table.userId),
]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  accountId: text("account_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  idToken: text("id_token"),
  password: text("password"),
  scope: text("scope"),
  ...timestamps,
}, (table) => [
  uniqueIndex("accounts_provider_unique").on(table.providerId, table.accountId),
  index("accounts_user_idx").on(table.userId),
]);

export const verifications = pgTable("verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => [
  index("verifications_identifier_idx").on(table.identifier),
]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  planCode: text("plan_code").notNull().default("free"),
  ...timestamps,
}, (table) => [
  uniqueIndex("workspaces_slug_unique").on(table.slug),
]);

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRole("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
  index("workspace_members_user_idx").on(table.userId),
]);

export const plans = pgTable("plans", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  priceKopecks: integer("price_kopecks").notNull(),
  includedSeconds: bigint("included_seconds", { mode: "number" }).notNull(),
  queueWeight: numeric("queue_weight", { precision: 5, scale: 2 }).notNull(),
  activeProjects: integer("active_projects").notNull(),
  sourceRetentionDays: integer("source_retention_days").notNull(),
  outputRetentionDays: integer("output_retention_days").notNull(),
  exportHeight: integer("export_height").notNull(),
  watermark: boolean("watermark").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  planCode: text("plan_code").notNull().references(() => plans.code),
  status: text("status").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  providerPaymentMethodId: text("provider_payment_method_id"),
  ...timestamps,
}, (table) => [
  index("subscriptions_workspace_idx").on(table.workspaceId),
]);

export const entitlementSnapshots = pgTable("entitlement_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
});

export const minuteBuckets = pgTable("minute_buckets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  grantedSeconds: bigint("granted_seconds", { mode: "number" }).notNull(),
  availableSeconds: bigint("available_seconds", { mode: "number" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  priority: integer("priority").notNull(),
  ...timestamps,
}, (table) => [
  index("minute_buckets_spend_idx").on(table.workspaceId, table.priority, table.expiresAt),
]);

export const minuteReservations = pgTable("minute_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id"),
  sourceFingerprint: text("source_fingerprint").notNull(),
  seconds: bigint("seconds", { mode: "number" }).notNull(),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("minute_reservations_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  index("minute_reservations_expiry_idx").on(table.status, table.expiresAt),
]);

export const minuteTransactions = pgTable("minute_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bucketId: uuid("bucket_id").references(() => minuteBuckets.id, { onDelete: "set null" }),
  reservationId: uuid("reservation_id").references(() => minuteReservations.id, { onDelete: "set null" }),
  kind: minuteTransactionKind("kind").notNull(),
  seconds: bigint("seconds", { mode: "number" }).notNull(),
  balanceAfterSeconds: bigint("balance_after_seconds", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("minute_transactions_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  index("minute_transactions_workspace_idx").on(table.workspaceId, table.createdAt),
]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  title: text("title").notNull(),
  status: projectStatus("status").notNull().default("draft"),
  currentVersion: integer("current_version").notNull().default(1),
  styleVersionId: uuid("style_version_id"),
  sourceId: uuid("source_id"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  idempotencyKey: text("idempotency_key").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("projects_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  index("projects_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
]);

export const projectVersions = pgTable("project_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_versions_unique").on(table.projectId, table.version),
]);

export const mediaObjects = pgTable("media_objects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bucket: text("bucket").notNull(),
  objectKey: text("object_key").notNull(),
  kind: text("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  sha256: text("sha256"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("media_objects_location_unique").on(table.bucket, table.objectKey),
  index("media_objects_retention_idx").on(table.expiresAt, table.deletedAt),
]);

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: sourceKind("kind").notNull(),
  providerRef: text("provider_ref"),
  originalMediaId: uuid("original_media_id").references(() => mediaObjects.id, { onDelete: "set null" }),
  proxyMediaId: uuid("proxy_media_id").references(() => mediaObjects.id, { onDelete: "set null" }),
  fingerprint: text("fingerprint"),
  durationMs: bigint("duration_ms", { mode: "number" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  lastProcessedAt: timestamp("last_processed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("sources_workspace_fingerprint_unique").on(table.workspaceId, table.fingerprint),
  index("sources_workspace_idx").on(table.workspaceId, table.createdAt),
]);

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "cascade" }),
  mediaObjectId: uuid("media_object_id").notNull().references(() => mediaObjects.id, { onDelete: "cascade" }),
  providerUploadId: text("provider_upload_id").notNull(),
  partSize: integer("part_size").notNull(),
  completedParts: jsonb("completed_parts").$type<Array<{ partNumber: number; etag: string }>>().notNull().default([]),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

export const transcripts = pgTable("transcripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  language: text("language").notNull(),
  originalPayload: jsonb("original_payload").$type<Record<string, unknown>>().notNull(),
  currentRevision: integer("current_revision").notNull().default(0),
  ...timestamps,
}, (table) => [
  uniqueIndex("transcripts_source_unique").on(table.sourceId),
]);

export const transcriptSegments = pgTable("transcript_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  transcriptId: uuid("transcript_id").notNull().references(() => transcripts.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  speakerId: text("speaker_id"),
  startMs: bigint("start_ms", { mode: "number" }).notNull(),
  endMs: bigint("end_ms", { mode: "number" }).notNull(),
  words: jsonb("words").$type<Array<Record<string, unknown>>>().notNull(),
  originalText: text("original_text").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("transcript_segments_ordinal_unique").on(table.transcriptId, table.ordinal),
]);

export const transcriptRevisions = pgTable("transcript_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  transcriptId: uuid("transcript_id").notNull().references(() => transcripts.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  operations: jsonb("operations").$type<Array<Record<string, unknown>>>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("transcript_revisions_unique").on(table.transcriptId, table.revision),
]);

export const stylePresets = pgTable("style_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  currentVersion: integer("current_version").notNull().default(1),
  isDefault: boolean("is_default").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("style_presets_workspace_idx").on(table.workspaceId, table.archivedAt),
  uniqueIndex("style_presets_default_unique").on(table.workspaceId, table.isDefault).where(sql`${table.isDefault} = true`),
]);

export const styleVersions = pgTable("style_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  stylePresetId: uuid("style_preset_id").notNull().references(() => stylePresets.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("style_versions_unique").on(table.stylePresetId, table.version),
]);

export const brandAssets = pgTable("brand_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  mediaObjectId: uuid("media_object_id").notNull().references(() => mediaObjects.id),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [
  uniqueIndex("brand_assets_media_object_unique").on(table.mediaObjectId),
  index("brand_assets_workspace_idx").on(table.workspaceId, table.createdAt),
]);

export const momentSearches = pgTable("moment_searches", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  transcriptRevision: integer("transcript_revision").notNull(),
  mode: text("mode").notNull(),
  query: text("query"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("queued"),
  ...timestamps,
}, (table) => [
  uniqueIndex("moment_searches_job_unique").on(table.jobId),
]);

export const momentCandidates = pgTable("moment_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  searchId: uuid("search_id").notNull().references(() => momentSearches.id, { onDelete: "cascade" }),
  startMs: bigint("start_ms", { mode: "number" }).notNull(),
  endMs: bigint("end_ms", { mode: "number" }).notNull(),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  explanation: text("explanation").notNull(),
  score: numeric("score", { precision: 5, scale: 2 }),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  selected: boolean("selected").notNull().default(true),
  ...timestamps,
});

export const momentRevisions = pgTable("moment_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  momentCandidateId: uuid("moment_candidate_id").notNull().references(() => momentCandidates.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  patch: jsonb("patch").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("moment_revisions_unique").on(table.momentCandidateId, table.revision),
]);

export const clips = pgTable("clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  momentCandidateId: uuid("moment_candidate_id").references(() => momentCandidates.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  // The clip editor's "Для соцсетей" fields — previously only React state,
  // lost on reload since nothing persisted them past the browser tab.
  socialTitle: text("social_title"),
  socialDescription: text("social_description"),
  status: text("status").notNull().default("draft"),
  currentVersion: integer("current_version").notNull().default(1),
  ...timestamps,
}, (table) => [
  index("clips_project_status_idx").on(table.projectId, table.status),
]);

export const clipVersions = pgTable("clip_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipId: uuid("clip_id").notNull().references(() => clips.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  edl: jsonb("edl").$type<Record<string, unknown>>().notNull(),
  /** Expand-only HVE v2 fields. Legacy EDL remains readable during rollout. */
  documentV2: jsonb("document_v2").$type<Record<string, unknown>>(),
  documentHash: text("document_hash"),
  /** Immutable editor metadata paired with this renderable HVE document. */
  editorMetadata: jsonb("editor_metadata").$type<Record<string, unknown>>(),
  layoutPlanId: uuid("layout_plan_id"),
  renderHash: text("render_hash").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("clip_versions_unique").on(table.clipId, table.version),
  index("clip_versions_render_hash_idx").on(table.renderHash),
]);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  clipId: uuid("clip_id").references(() => clips.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  class: jobClass("class").notNull(),
  status: jobStatus("status").notNull().default("queued"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  idempotencyKey: text("idempotency_key").notNull(),
  artifactHash: text("artifact_hash"),
  checkpoint: text("checkpoint"),
  estimatedCost: numeric("estimated_cost", { precision: 12, scale: 3 }).notNull().default("1"),
  queueWeight: numeric("queue_weight", { precision: 5, scale: 2 }).notNull().default("1"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: jsonb("error").$type<Record<string, unknown>>(),
  ...timestamps,
}, (table) => [
  uniqueIndex("jobs_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  index("jobs_claim_idx").on(table.status, table.class, table.availableAt, table.createdAt),
  index("jobs_workspace_fairness_idx").on(table.workspaceId, table.status, table.createdAt),
  index("jobs_lease_idx").on(table.status, table.leaseExpiresAt),
]);

/**
 * Persistent weighted-fair-queue state.  It stores no user media or task
 * payload: only the virtual service consumed by a workspace.  The claim
 * transaction locks this row before advancing it, so a second worker cannot
 * accidentally reset a busy workspace back to the head of the queue.
 */
export const workspaceQueueStates = pgTable("workspace_queue_states", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  virtualFinish: numeric("virtual_finish", { precision: 20, scale: 6 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A singleton dispatch streak guard complements weighted fair sharing. It is
 * global rather than per-worker, so the no-monopoly rule still applies after
 * a second worker joins the pool.
 */
export const queueDispatchStates = pgTable("queue_dispatch_states", {
  id: integer("id").primaryKey(),
  lastWorkspaceId: uuid("last_workspace_id"),
  consecutiveClaims: integer("consecutive_claims").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An immutable, retained snapshot of the ready clips a user asked to download.
 * It is deliberately separate from `jobs.result`: a job attempt is operational
 * state, while a package remains an auditable user-visible export that can be
 * signed, retained and later regenerated from the same manifest.
 */
export const projectPackages = pgTable("project_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  mediaObjectId: uuid("media_object_id").references(() => mediaObjects.id, { onDelete: "set null" }),
  status: text("status").notNull().default("queued"),
  manifestHash: text("manifest_hash").notNull(),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
  error: jsonb("error").$type<Record<string, unknown>>(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("project_packages_manifest_unique").on(table.projectId, table.manifestHash),
  index("project_packages_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
]);

export const jobAttempts = pgTable("job_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  workerId: text("worker_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
  error: jsonb("error").$type<Record<string, unknown>>(),
}, (table) => [
  uniqueIndex("job_attempts_unique").on(table.jobId, table.attempt),
]);

export const jobEvents = pgTable("job_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("job_events_stream_idx").on(table.workspaceId, table.id),
]);

export const workerLeases = pgTable("worker_leases", {
  workerId: text("worker_id").primaryKey(),
  capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull(),
  version: text("version").notNull(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
});

/** Capability and resource admission constraints for HVE jobs. Legacy jobs have no row and remain compatible. */
export const jobRequirements = pgTable("job_requirements", {
  jobId: uuid("job_id").primaryKey().references(() => jobs.id, { onDelete: "cascade" }),
  requirements: jsonb("requirements").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const qualityReports = pgTable("quality_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  engineReleaseId: uuid("engine_release_id").references(() => engineReleases.id, { onDelete: "set null" }),
  suite: text("suite").notNull(),
  status: text("status").notNull(),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
  reportArtifactId: uuid("report_artifact_id").references(() => analysisArtifacts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("quality_reports_release_idx").on(table.engineReleaseId, table.createdAt),
]);

export const benchmarkRuns = pgTable("benchmark_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  engineReleaseId: uuid("engine_release_id").references(() => engineReleases.id, { onDelete: "set null" }),
  hardwareProfile: jsonb("hardware_profile").$type<Record<string, unknown>>().notNull(),
  stageMetrics: jsonb("stage_metrics").$type<Record<string, unknown>>().notNull(),
  baselineComparison: jsonb("baseline_comparison").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("benchmark_runs_release_idx").on(table.engineReleaseId, table.createdAt),
]);

export const engineReleases = pgTable("engine_releases", {
  id: uuid("id").primaryKey().defaultRandom(),
  engineVersion: text("engine_version").notNull(),
  plannerVersion: text("planner_version").notNull(),
  rendererVersion: text("renderer_version").notNull(),
  contractVersion: integer("contract_version").notNull().default(2),
  capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("active"),
  ...timestamps,
}, (table) => [
  uniqueIndex("engine_releases_version_unique").on(table.engineVersion, table.plannerVersion, table.rendererVersion),
]);

export const modelArtifacts = pgTable("model_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  engineReleaseId: uuid("engine_release_id").references(() => engineReleases.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  version: text("version").notNull(),
  sha256: text("sha256").notNull(),
  license: text("license").notNull(),
  compatibility: jsonb("compatibility").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("model_artifacts_hash_unique").on(table.name, table.version, table.sha256),
]);

export const sourceAnalyses = pgTable("source_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  engineReleaseId: uuid("engine_release_id").references(() => engineReleases.id, { onDelete: "set null" }),
  sourceHash: text("source_hash").notNull(),
  status: text("status").notNull().default("queued"),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
  manifestHash: text("manifest_hash").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("source_analyses_source_manifest_unique").on(table.sourceId, table.engineReleaseId, table.manifestHash),
  index("source_analyses_source_idx").on(table.sourceId, table.createdAt),
]);

export const analysisArtifacts = pgTable("analysis_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  analysisId: uuid("analysis_id").notNull().references(() => sourceAnalyses.id, { onDelete: "cascade" }),
  mediaObjectId: uuid("media_object_id").references(() => mediaObjects.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  engineVersion: text("engine_version").notNull(),
  modelVersion: text("model_version"),
  objectKey: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  coverage: jsonb("coverage").$type<Array<Record<string, unknown>>>().notNull().default([]),
  density: text("density").notNull().default("sparse"),
  supersedes: jsonb("supersedes").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("analysis_artifacts_object_unique").on(table.analysisId, table.kind, table.objectKey),
  index("analysis_artifacts_analysis_idx").on(table.analysisId, table.kind),
]);

export const layoutPlans = pgTable("layout_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipVersionId: uuid("clip_version_id").references(() => clipVersions.id, { onDelete: "cascade" }),
  documentHash: text("document_hash").notNull(),
  planHash: text("plan_hash").notNull(),
  plannerVersion: text("planner_version").notNull(),
  plan: jsonb("plan").$type<Record<string, unknown>>(),
  planArtifactId: uuid("plan_artifact_id").references(() => analysisArtifacts.id, { onDelete: "set null" }),
  warnings: jsonb("warnings").$type<Array<Record<string, unknown>>>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("layout_plans_hash_unique").on(table.documentHash, table.plannerVersion, table.planHash),
  index("layout_plans_clip_version_idx").on(table.clipVersionId, table.createdAt),
]);

export const clipDrafts = pgTable("clip_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clipId: uuid("clip_id").notNull().references(() => clips.id, { onDelete: "cascade" }),
  baseVersion: integer("base_version").notNull(),
  revision: integer("revision").notNull().default(0),
  document: jsonb("document").$type<Record<string, unknown>>().notNull(),
  documentHash: text("document_hash").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid("updated_by").notNull().references(() => users.id),
  ...timestamps,
}, (table) => [
  uniqueIndex("clip_drafts_clip_unique").on(table.clipId),
  index("clip_drafts_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
]);

export const editorCommandBatches = pgTable("editor_command_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipDraftId: uuid("clip_draft_id").notNull().references(() => clipDrafts.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").notNull(),
  baseRevision: integer("base_revision").notNull(),
  resultingRevision: integer("resulting_revision").notNull(),
  commands: jsonb("commands").$type<Array<Record<string, unknown>>>().notNull(),
  results: jsonb("results").$type<Array<Record<string, unknown>>>().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("editor_command_batches_unique").on(table.clipDraftId, table.batchId),
  index("editor_command_batches_draft_idx").on(table.clipDraftId, table.createdAt),
]);

export const renderArtifacts = pgTable("render_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipVersionId: uuid("clip_version_id").notNull().references(() => clipVersions.id, { onDelete: "cascade" }),
  mediaObjectId: uuid("media_object_id").notNull().references(() => mediaObjects.id),
  kind: text("kind").notNull(),
  validation: jsonb("validation").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("render_artifacts_unique").on(table.clipVersionId, table.kind),
]);

export const generativeOperations = pgTable("generative_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  clipId: uuid("clip_id").references(() => clips.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("quoted"),
  estimatedUnits: numeric("estimated_units", { precision: 14, scale: 4 }).notNull(),
  actualUnits: numeric("actual_units", { precision: 14, scale: 4 }),
  estimatedPriceKopecks: integer("estimated_price_kopecks").notNull(),
  actualPriceKopecks: integer("actual_price_kopecks"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  idempotencyKey: text("idempotency_key").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("generative_operations_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  index("generative_operations_workspace_idx").on(table.workspaceId, table.createdAt),
  index("generative_operations_clip_idx").on(table.clipId, table.createdAt),
]);

export const generativeBalanceTransactions = pgTable("generative_balance_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  operationId: uuid("operation_id").references(() => generativeOperations.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  amountKopecks: integer("amount_kopecks").notNull(),
  balanceAfterKopecks: integer("balance_after_kopecks").notNull(),
  reason: text("reason").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("generative_balance_transactions_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  index("generative_balance_transactions_workspace_idx").on(table.workspaceId, table.createdAt),
]);

export const idempotencyRecords = pgTable("idempotency_records", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  statusCode: integer("status_code"),
  response: jsonb("response").$type<unknown>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.key] }),
  index("idempotency_expiry_idx").on(table.expiresAt),
]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("tbank"),
  providerPaymentId: text("provider_payment_id").notNull(),
  status: paymentStatus("status").notNull(),
  amountKopecks: integer("amount_kopecks").notNull(),
  currency: text("currency").notNull().default("RUB"),
  paymentMethodId: text("payment_method_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [
  uniqueIndex("payments_provider_unique").on(table.provider, table.providerPaymentId),
  uniqueIndex("payments_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
]);

export const paymentWebhooks = pgTable("payment_webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("tbank"),
  providerEventId: text("provider_event_id").notNull(),
  signatureValid: boolean("signature_valid").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("payment_webhooks_provider_unique").on(table.provider, table.providerEventId),
]);

export const providerUsageCosts = pgTable("provider_usage_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  units: numeric("units", { precision: 14, scale: 4 }).notNull(),
  costKopecks: integer("cost_kopecks").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_events_created_idx").on(table.createdAt),
  index("audit_events_actor_idx").on(table.actorUserId, table.createdAt),
  index("audit_events_entity_idx").on(table.entityType, table.entityId, table.createdAt),
]);

export const outboxEvents = pgTable("outbox_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  topic: text("topic").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("outbox_pending_idx").on(table.deliveredAt, table.availableAt),
]);
