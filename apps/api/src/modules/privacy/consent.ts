import type { Pool, PoolClient } from "pg";
import { PRIVACY_NOTICE_VERSION, type ConsentAction, type ConsentPurpose } from "@meetcon/shared";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/index.js";

type Sql = Pool | PoolClient;

export function privacyContact() {
  return {
    noticeVersion: PRIVACY_NOTICE_VERSION,
    fiduciaryName: config.DPDP_FIDUCIARY_NAME,
    grievanceEmail: config.DPDP_GRIEVANCE_EMAIL,
    grievancePostal: config.DPDP_GRIEVANCE_POSTAL || null,
  };
}

export function privacyCurrent(version: string | null | undefined) {
  return version === PRIVACY_NOTICE_VERSION;
}

export async function recordConsent(db: Sql, userId: string, purpose: ConsentPurpose, action: ConsentAction) {
  await db.query(
    `INSERT INTO consent_events(user_id, purpose, action, notice_version) VALUES($1,$2,$3,$4)`,
    [userId, purpose, action, PRIVACY_NOTICE_VERSION],
  );
}

export async function acceptPrivacy(userId: string) {
  await transaction(async (client) => {
    await client.query(`UPDATE users SET privacy_notice_version=$2, privacy_accepted_at=clock_timestamp(),
      age_confirmed_at=COALESCE(age_confirmed_at, clock_timestamp()), updated_at=clock_timestamp()
      WHERE id=$1 AND status='ACTIVE'`, [userId, PRIVACY_NOTICE_VERSION]);
    await recordConsent(client, userId, "account", "granted");
    const linked = (await client.query("SELECT linkedin_sub FROM users WHERE id=$1", [userId])).rows[0] as { linkedin_sub: string | null } | undefined;
    if (!linked?.linkedin_sub) return;
    const latest = (await client.query(`SELECT action FROM consent_events
      WHERE user_id=$1 AND purpose='linkedin' ORDER BY created_at DESC LIMIT 1`, [userId])).rows[0] as { action: string } | undefined;
    if (latest?.action !== "granted") await recordConsent(client, userId, "linkedin", "granted");
  });
}
