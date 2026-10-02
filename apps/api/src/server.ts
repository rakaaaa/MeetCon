import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config, isProduction } from "./config.js";
import { pool } from "./db/index.js";
import { AppError, authenticate, noStore, requireOrigin } from "./lib.js";
import { answerRoutes } from "./modules/answers/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { liveStateRoutes } from "./modules/live-state/routes.js";
import { membershipRoutes } from "./modules/memberships/routes.js";
import { meetupRoutes } from "./modules/meetups/routes.js";
import { profileRoutes } from "./modules/profiles/routes.js";
import { resultRoutes } from "./modules/results/routes.js";
import { publisher, subscriber } from "./redis.js";

const app = Fastify({
  logger: {
    level: isProduction ? "info" : "debug",
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie", "body.password", "body.token", "body.currentPassword", "body.newPassword"],
  },
  trustProxy: isProduction,
  bodyLimit: 1_000_000,
  requestIdHeader: "x-request-id",
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
await app.register(cookie);
await app.register(multipart, { limits: { files: 1, fileSize: config.MAX_IMAGE_BYTES } });
await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
app.decorateRequest("user", null);
app.addHook("onRequest", async (request, reply) => {
  await authenticate(request);
  if (request.url.startsWith("/api/")) noStore(reply);
});
app.addHook("preHandler", async (request) => requireOrigin(request));

app.get("/health", async (_request, reply) => {
  try {
    await pool.query("SELECT 1");
    const redis = await publisher.ping();
    return { status: "ok", database: "ok", redis: redis === "PONG" ? "ok" : "degraded", time: new Date().toISOString() };
  } catch {
    return reply.code(503).send({ status: "unhealthy" });
  }
});
app.get("/media/*", async (request, reply) => {
  const key = (request.params as { "*": string })["*"];
  const root = resolve(config.MEDIA_DIR), path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new AppError(404, "NOT_FOUND", "Media not found");
  try {
    const type = new Map([[".jpg","image/jpeg"],[".png","image/png"],[".webp","image/webp"]]).get(extname(path).toLowerCase());
    if (!type) throw new AppError(404, "NOT_FOUND", "Media not found");
    return reply.header("Content-Type", type).header("Cache-Control", "no-store, private").send(await readFile(path));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(404, "NOT_FOUND", "Media not found");
  }
});

await app.register(authRoutes, { prefix: "/api" });
await app.register(profileRoutes, { prefix: "/api" });
await app.register(meetupRoutes, { prefix: "/api" });
await app.register(membershipRoutes, { prefix: "/api" });
await app.register(liveStateRoutes, { prefix: "/api" });
await app.register(answerRoutes, { prefix: "/api" });
await app.register(resultRoutes, { prefix: "/api" });

app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }));
app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.flatten() } });
  if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
  const status = "statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500 ? error.statusCode : 500;
  if (status >= 500) request.log.error({ err: error }, "Unhandled request error");
  return reply.code(status).send({ error: { code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", message: status === 500 ? "An unexpected error occurred" : error.message } });
});

const cleanup = setInterval(() => void pool.query(`DELETE FROM auth_sessions WHERE expires_at<now();
  DELETE FROM password_reset_tokens WHERE expires_at<now() OR used_at<now()-interval '7 days'`).catch((error) => app.log.error(error)), 60 * 60_000);
cleanup.unref();

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down");
  clearInterval(cleanup);
  await app.close();
  await Promise.allSettled([publisher.quit(), subscriber.quit(), pool.end()]);
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.API_HOST, port: config.API_PORT });
