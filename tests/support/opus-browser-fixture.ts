/** Local browser fixture only. Never import into application bundles. */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { closeDb, createDb } from "../../db/index.js";
import { accounts, mediaObjects, minuteBuckets, sources, stylePresets, styleVersions, transcripts, users, workspaceMembers, workspaces } from "../../db/schema.js";
import { defaultStyleConfig } from "../../packages/product-config/src/index.js";
import { resolveHveTestDatabaseUrl } from "./hve-test-database.js";

const url = resolveHveTestDatabaseUrl();
if (!url) throw new Error("Explicit local test database acknowledgement required");
const db = createDb(url);
const suffix = randomUUID().slice(0, 8);
const email = `opus-qa-${suffix}@example.test`;
const password = "Local-QA-Only-20261012!";
try {
  const [user] = await db.insert(users).values({ email, name: "Тестовый аккаунт", emailVerified: true }).returning();
  await db.insert(accounts).values({ userId: user.id, providerId: "credential", accountId: user.id, password: await hashPassword(password) });
  const [workspace] = await db.insert(workspaces).values({ name: "Локальный browser QA", slug: `opus-qa-${suffix}`, planCode: "creator" }).returning();
  await db.insert(workspaceMembers).values({ userId: user.id, workspaceId: workspace.id, role: "owner" });
  await db.insert(minuteBuckets).values({ workspaceId: workspace.id, source: "test_fixture", grantedSeconds: 7740, availableSeconds: 7740, priority: 10 });
  const [preset] = await db.insert(stylePresets).values({ workspaceId: workspace.id, name: "Основной", description: "Тестовый шаблон", isDefault: true }).returning();
  await db.insert(styleVersions).values({ stylePresetId: preset.id, version: 1, config: defaultStyleConfig, createdBy: user.id });
  const [media] = await db.insert(mediaObjects).values({ workspaceId: workspace.id, bucket: "test-only", objectKey: `synthetic-${suffix}.mp4`, kind: "source", mimeType: "video/mp4", byteSize: 100, expiresAt: new Date(Date.now() + 86400000) }).returning();
  const [source] = await db.insert(sources).values({ workspaceId: workspace.id, kind: "upload", originalMediaId: media.id, durationMs: 1314000, fingerprint: "b".repeat(64), analyzedAt: new Date(), metadata: { title: "Тестовый источник · параметры нарезки", syntheticFixture: true } }).returning();
  await db.insert(transcripts).values({ sourceId: source.id, provider: "test_adapter", language: "ru", originalPayload: { segments: [] } });
  console.log(JSON.stringify({ email, password, sourceId: source.id, workspaceId: workspace.id, syntheticFixture: true }));
} finally { await closeDb(); }
