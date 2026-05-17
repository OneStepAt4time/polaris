import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { registerAuth } from "./auth.js";
import { type Config, loadConfig } from "./config.js";
import { type PolarisDb, openDb } from "./db.js";
import { ingest } from "./ingest/ingest.js";

const IngestBodySchema = z.object({
  sessionFile: z.string().min(1),
  content: z.string(),
});

export interface BuildResult {
  app: FastifyInstance;
  config: Config;
  db: PolarisDb;
}

export async function buildServer(): Promise<BuildResult> {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
    },
  });

  const db = openDb(config.dbPath);
  app.addHook("onClose", async () => {
    db.close();
  });

  await app.register(sensible);
  registerAuth(app, config.authToken);

  app.get("/health", () => ({
    status: "ok",
    service: "polaris",
    version: "0.0.0",
  }));

  app.post("/v1/ingest", { config: { requireAuth: true } }, async (request, reply) => {
    const parsed = IngestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const result = ingest(db, parsed.data.sessionFile, parsed.data.content);
    return reply.send(result);
  });

  return { app, config, db };
}

async function main(): Promise<void> {
  const { app, config } = await buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
  void main();
}
