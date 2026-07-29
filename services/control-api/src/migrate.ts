import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, createDb } from "../../../db/index.js";

await migrate(createDb(), {
  migrationsFolder: "/app/drizzle",
  migrationsSchema: "public",
  migrationsTable: "__drizzle_migrations",
});
await closeDb();
