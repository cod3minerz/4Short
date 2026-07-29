import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

let client: ReturnType<typeof postgres> | undefined;

function databaseSsl() {
  const mode = process.env.DATABASE_SSL ?? "require";

  if (mode === "disable") return false;
  if (mode === "verify-full") {
    const rootCertificatePath = process.env.DATABASE_SSL_ROOT_CERT;
    if (!rootCertificatePath) {
      throw new Error("DATABASE_SSL_ROOT_CERT is required when DATABASE_SSL=verify-full");
    }

    return {
      ca: readFileSync(rootCertificatePath, "utf8"),
      rejectUnauthorized: true,
    };
  }

  return "require" as const;
}

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  client ??= postgres(databaseUrl, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: databaseSsl(),
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

export async function closeDb() {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
  }
}
