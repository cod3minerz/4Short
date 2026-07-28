import type { FastifyReply, FastifyRequest } from "fastify";

export async function handleBetterAuth(request: FastifyRequest, reply: FastifyReply) {
  const origin = `${request.protocol}://${request.headers.host}`;
  const url = new URL(request.url, origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }

  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : JSON.stringify(request.body ?? {});
  if (body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await (await import("../auth/index.js")).auth.handler(new Request(url, {
    method: request.method,
    headers,
    body,
  }));

  reply.status(response.status);
  response.headers.forEach((value, key) => reply.header(key, value));
  const responseBody = response.body ? await response.arrayBuffer() : undefined;
  return reply.send(responseBody ? Buffer.from(responseBody) : undefined);
}

export function getIdempotencyKey(request: FastifyRequest) {
  const value = request.headers["idempotency-key"];
  if (!value || Array.isArray(value) || value.length < 8 || value.length > 200) {
    throw request.server.httpErrors.badRequest("Idempotency-Key is required");
  }
  return value;
}
