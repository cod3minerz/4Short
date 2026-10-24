import assert from "node:assert/strict";
import test from "node:test";
import { isLocalDevelopmentIdentityEnabled, isLoopbackHostname, localWorkspaceStorageKey } from "../../app/dashboard/lib/control-api";

test("development identity is restricted to explicitly configured loopback development", () => {
  assert.equal(isLocalDevelopmentIdentityEnabled("localhost", "development", "test-user"), true);
  assert.equal(isLocalDevelopmentIdentityEnabled("127.0.0.1", "development", "test-user"), true);
  assert.equal(isLocalDevelopmentIdentityEnabled("::1", "development", "test-user"), true);
  assert.equal(isLocalDevelopmentIdentityEnabled("localhost", "production", "test-user"), false);
  assert.equal(isLocalDevelopmentIdentityEnabled("app.example.com", "development", "test-user"), false);
  assert.equal(isLocalDevelopmentIdentityEnabled("localhost", "development", undefined), false);
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("localhost.example.com"), false);
  assert.equal(localWorkspaceStorageKey(true), "hashpix:development-workspace-id");
  assert.equal(localWorkspaceStorageKey(false), "hashpix:workspace-id");
});
