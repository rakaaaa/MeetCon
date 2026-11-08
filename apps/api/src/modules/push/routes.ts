import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../../db/index.js";
import { noStore, requireUser } from "../../lib.js";
import { recordConsent } from "../privacy/consent.js";
import { pushPublicKey } from "./keys.js";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }).strict(),
}).strict();

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.get("/push/public-key", async (request, reply) => {
    requireUser(request);
    noStore(reply);
    return { publicKey: pushPublicKey() };
  });

  app.put("/push/subscription", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = requireUser(request);
    const input = subscriptionSchema.parse(request.body);
    await pool.query(`INSERT INTO push_subscriptions(endpoint, user_id, p256dh, auth)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth`,
      [input.endpoint, user.id, input.keys.p256dh, input.keys.auth]);
    await recordConsent(pool, user.id, "push", "granted");
    noStore(reply);
    return reply.code(204).send();
  });

  app.delete("/push/subscription", async (request, reply) => {
    const user = requireUser(request);
    const input = z.object({ endpoint: z.string().url().max(4000) }).strict().parse(request.body);
    const removed = await pool.query("DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2 RETURNING endpoint", [input.endpoint, user.id]);
    if (removed.rowCount) await recordConsent(pool, user.id, "push", "withdrawn");
    noStore(reply);
    return reply.code(204).send();
  });
}
