import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { createDb, type Database } from "../../../../db/index.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    requireWorkspace(request: import("fastify").FastifyRequest): Promise<void>;
    requirePlatformAdmin(request: import("fastify").FastifyRequest): Promise<void>;
  }
}

export const databasePlugin = fp(async (app: FastifyInstance) => {
  app.decorate("db", createDb());
});
