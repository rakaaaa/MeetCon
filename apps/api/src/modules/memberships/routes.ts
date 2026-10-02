import type { FastifyInstance } from "fastify";
import { JoinCodeSchema, JoinTokenSchema } from "@meetcon/shared";
import { pool, transaction } from "../../db/index.js";
import { AppError, iso, noStore, requireUser, sha256 } from "../../lib.js";

const neutral = () => new AppError(404, "INVITATION_INVALID", "Invitation is invalid or no longer available");
function preview(row: any) {
  return { id: row.id, title: row.title, organizer: row.display_name, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), questionCount: Number(row.question_count) };
}
async function lookup(kind: "CODE" | "LINK", value: string) {
  const column = kind === "CODE" ? "m.public_code=$1" : "m.join_token_hash=$1";
  const parameter = kind === "CODE" ? Number(value) : sha256(value);
  const result = await pool.query(`SELECT m.id,m.title,m.starts_at,m.ends_at,m.status,u.display_name,count(q.id) question_count,
    clock_timestamp() db_now FROM meetups m JOIN users u ON u.id=m.owner_id LEFT JOIN questions q ON q.meetup_id=m.id
    WHERE ${column} GROUP BY m.id,u.display_name`, [parameter]);
  const row = result.rows[0];
  if (!row || row.status !== "PUBLISHED" || new Date(row.db_now) >= new Date(row.ends_at)) throw neutral();
  return row;
}

export async function membershipRoutes(app: FastifyInstance): Promise<void> {
  app.post("/join/code/preview", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (request, reply) => {
    requireUser(request, "USER"); const { code } = JoinCodeSchema.parse(request.body); noStore(reply);
    return { meetup: preview(await lookup("CODE", code)) };
  });
  app.post("/join/token/preview", { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } }, async (request, reply) => {
    requireUser(request, "USER"); const { token } = JoinTokenSchema.parse(request.body); noStore(reply);
    return { meetup: preview(await lookup("LINK", token)) };
  });
  app.post("/join/code", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const user = requireUser(request, "USER"), { code } = JoinCodeSchema.parse(request.body);
    const row = await lookup("CODE", code); return join(row.id, user.id, "CODE", reply);
  });
  app.post("/join/token", { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const user = requireUser(request, "USER"), { token } = JoinTokenSchema.parse(request.body);
    const row = await lookup("LINK", token); return join(row.id, user.id, "LINK", reply);
  });
  app.get("/my-meetups", async (request, reply) => {
    const user = requireUser(request, "USER");
    const rows = (await pool.query(`SELECT m.id,m.title,m.starts_at,m.ends_at,m.status,u.display_name organizer,
      count(DISTINCT q.id) question_count,clock_timestamp() server_time
      FROM meetup_members mm JOIN meetups m ON m.id=mm.meetup_id JOIN users u ON u.id=m.owner_id
      LEFT JOIN questions q ON q.meetup_id=m.id WHERE mm.user_id=$1 GROUP BY m.id,u.display_name
      ORDER BY m.starts_at DESC`, [user.id])).rows;
    noStore(reply);
    return { meetups: rows.map((row) => ({ ...preview({ ...row, display_name: row.organizer }), status: row.status })), serverTime: rows[0]?.server_time ?? new Date().toISOString() };
  });
}
async function join(meetupId: string, userId: string, via: "CODE" | "LINK", reply: any) {
  const result = await transaction(async (client) => {
    const locked = (await client.query(`SELECT status,ends_at,clock_timestamp() db_now FROM meetups WHERE id=$1 FOR SHARE`, [meetupId])).rows[0];
    if (!locked || locked.status !== "PUBLISHED" || new Date(locked.db_now) >= new Date(locked.ends_at)) throw neutral();
    const inserted = await client.query(`INSERT INTO meetup_members(meetup_id,user_id,joined_via) VALUES($1,$2,$3)
      ON CONFLICT(meetup_id,user_id) DO UPDATE SET last_opened_at=clock_timestamp()
      RETURNING meetup_id,joined_at,(xmax=0) created`, [meetupId, userId, via]);
    return inserted.rows[0];
  });
  noStore(reply); return reply.code(result.created ? 201 : 200).send({ meetupId: result.meetup_id, joinedAt: result.joined_at, alreadyJoined: !result.created });
}
