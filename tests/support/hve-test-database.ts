/**
 * Deliberately destructive HVE integration suites are allowed to run only
 * against an explicitly named test database. An opt-in environment variable
 * alone is not enough: it is far too easy to copy a production connection
 * string into a local shell while debugging an incident.
 */
type HveTestEnvironment = {
  HVE_TEST_DATABASE_URL?: string;
  HVE_ALLOW_DESTRUCTIVE_INTEGRATION_TESTS?: string;
};

export function resolveHveTestDatabaseUrl(environment: HveTestEnvironment = process.env as HveTestEnvironment): string | undefined {
  const value = environment.HVE_TEST_DATABASE_URL?.trim();
  const allowed = environment.HVE_ALLOW_DESTRUCTIVE_INTEGRATION_TESTS === "1";
  if (!value || !allowed) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("HVE_TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("HVE_TEST_DATABASE_URL must use postgresql:// or postgres://");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  // `fourshort_test`, `fourshort-ci`, `ci_fourshort` and similar names are
  // valid. `fourshort` is intentionally rejected even after an operator
  // typed the destructive acknowledgement.
  if (!/(^|[-_])(test|ci)([-_]|$)|(?:test|ci)$/i.test(databaseName)) {
    throw new Error(
      `Refusing destructive HVE integration tests against database "${databaseName || "(empty)"}". Use a dedicated name containing test or ci.`,
    );
  }
  return value;
}
