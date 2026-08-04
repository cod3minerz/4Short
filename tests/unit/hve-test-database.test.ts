import assert from "node:assert/strict";
import test from "node:test";
import { resolveHveTestDatabaseUrl } from "../support/hve-test-database.js";

const enabled = (url: string) => ({
  HVE_TEST_DATABASE_URL: url,
  HVE_ALLOW_DESTRUCTIVE_INTEGRATION_TESTS: "1",
});

test("HVE queue integration needs an explicit destructive opt-in", () => {
  assert.equal(resolveHveTestDatabaseUrl({ HVE_TEST_DATABASE_URL: "postgresql://localhost/fourshort_test" }), undefined);
  assert.equal(resolveHveTestDatabaseUrl({ HVE_ALLOW_DESTRUCTIVE_INTEGRATION_TESTS: "1" }), undefined);
});

test("HVE queue integration accepts only an explicitly named test database", () => {
  assert.equal(
    resolveHveTestDatabaseUrl(enabled("postgresql://postgres:postgres@localhost:5432/fourshort_test")),
    "postgresql://postgres:postgres@localhost:5432/fourshort_test",
  );
  assert.equal(
    resolveHveTestDatabaseUrl(enabled("postgres://postgres:postgres@localhost:5432/ci-fourshort")),
    "postgres://postgres:postgres@localhost:5432/ci-fourshort",
  );
  assert.throws(
    () => resolveHveTestDatabaseUrl(enabled("postgresql://postgres:postgres@localhost:5432/fourshort")),
    /Refusing destructive HVE integration tests/,
  );
  assert.throws(
    () => resolveHveTestDatabaseUrl(enabled("https://example.test/fourshort_test")),
    /must use postgresql/,
  );
});
