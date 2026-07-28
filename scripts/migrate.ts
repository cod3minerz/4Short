import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, createDb } from "../db/index";

await migrate(createDb(), { migrationsFolder: "./drizzle" });
await closeDb();
