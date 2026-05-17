import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { type Config, loadConfig } from "./config.js";

export interface BuildResult {
  app: FastifyInstance;
  config: Config;
}

export async function buildServer(): Promise<BuildResult> {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
    },
  });

  await app.register(sensible);

  app.get("/health", () => ({
    status: "ok",
    service: "polaris",
    version: "0.0.0",
  }));

  return { app, config };
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

// Run main() only when this file is executed directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
  void main();
}
