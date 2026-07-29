import assert from "node:assert/strict";
import test from "node:test";
import {
  adminMinuteAdjustmentSchema,
  adminUserStatusUpdateSchema,
} from "../../packages/contracts/src/admin.js";
import { hasAdminPermission } from "../../services/control-api/src/auth/permissions.js";

test("platform roles are separate and monotonic", () => {
  assert.equal(hasAdminPermission("user", "platform:read"), false);
  assert.equal(hasAdminPermission("support", "platform:read"), true);
  assert.equal(hasAdminPermission("support", "users:write"), false);
  assert.equal(hasAdminPermission("admin", "users:write"), true);
  assert.equal(hasAdminPermission("admin", "roles:write"), false);
  assert.equal(hasAdminPermission("super_admin", "roles:write"), true);
});

test("suspension requires a reason and minute adjustment cannot be zero", () => {
  assert.equal(adminUserStatusUpdateSchema.safeParse({ status: "suspended" }).success, false);
  assert.equal(adminUserStatusUpdateSchema.safeParse({ status: "suspended", reason: "Нарушение правил" }).success, true);
  assert.equal(adminUserStatusUpdateSchema.safeParse({ status: "active" }).success, true);
  assert.equal(adminMinuteAdjustmentSchema.safeParse({ seconds: 0, reason: "Коррекция" }).success, false);
  assert.equal(adminMinuteAdjustmentSchema.safeParse({ seconds: 3600, reason: "Компенсация" }).success, true);
});
