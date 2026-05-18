import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyContextConfig {
    requireAuth?: boolean;
  }
}

export function registerAuth(app: FastifyInstance, expectedToken: string): void {
  app.addHook("preHandler", async (request, reply) => {
    const routeConfig = request.routeOptions.config as { requireAuth?: boolean } | undefined;
    if (!routeConfig?.requireAuth) return;
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing or malformed Authorization header" });
    }
    const token = header.slice("Bearer ".length).trim();
    if (token !== expectedToken) {
      return reply.code(401).send({ error: "Invalid token" });
    }
  });
}
