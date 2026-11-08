import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "../../config.js";
import { pool } from "../../db/index.js";
import { AppError, decryptToken, encryptToken, token } from "../../lib.js";

export type LinkedInProfile = {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  email?: string;
  email_verified?: boolean;
};

const imageTypes = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);

function clip(value: string | undefined, max: number) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, max) : null;
}

function imageExtension(contentType: string | null, url: string) {
  const mapped = imageTypes.get(contentType?.split(";")[0]?.trim() ?? "");
  if (mapped) return mapped;
  if (/\.png($|\?)/i.test(url)) return ".png";
  if (/\.webp($|\?)/i.test(url)) return ".webp";
  if (/\.jpe?g($|\?)/i.test(url)) return ".jpg";
  return null;
}

export async function fetchLinkedInUserInfo(accessToken: string): Promise<LinkedInProfile> {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) throw new AppError(409, "LINKEDIN_REAUTH", "Sign in with LinkedIn again to refresh this profile.");
  if (!response.ok) throw new AppError(502, "LINKEDIN_PROFILE", "LinkedIn did not return a profile.");
  return response.json() as Promise<LinkedInProfile>;
}

export async function rememberLinkedInProfile(userId: string, profile: LinkedInProfile, accessToken: string, expiresIn: number | undefined) {
  const expires = new Date(Date.now() + Math.max(60, expiresIn ?? 3600) * 1000);
  await pool.query(`UPDATE users SET given_name=$2, family_name=$3, locale=$4, email_verified=$5,
    linkedin_picture_url=$6, linkedin_access_ciphertext=$7, linkedin_access_expires_at=$8, updated_at=now()
    WHERE id=$1`, [
    userId,
    clip(profile.given_name, 80),
    clip(profile.family_name, 80),
    clip(profile.locale, 35),
    profile.email_verified !== false,
    profile.picture?.startsWith("https://") ? profile.picture.slice(0, 1000) : null,
    encryptToken(accessToken),
    expires,
  ]);
  await storeLinkedInPicture(userId, profile.picture);
}

export async function syncStoredLinkedInProfile(userId: string) {
  const row = (await pool.query(`SELECT linkedin_sub, linkedin_access_ciphertext, linkedin_access_expires_at
    FROM users WHERE id=$1`, [userId])).rows[0];
  if (!row?.linkedin_sub) throw new AppError(400, "NOT_LINKEDIN", "This account is not connected to LinkedIn.");
  if (!row.linkedin_access_ciphertext || !row.linkedin_access_expires_at || new Date(row.linkedin_access_expires_at).getTime() <= Date.now()) {
    throw new AppError(409, "LINKEDIN_REAUTH", "Sign in with LinkedIn again to refresh this profile.");
  }
  let accessToken: string;
  try {
    accessToken = decryptToken(row.linkedin_access_ciphertext);
  } catch {
    throw new AppError(409, "LINKEDIN_REAUTH", "Sign in with LinkedIn again to refresh this profile.");
  }
  const profile = await fetchLinkedInUserInfo(accessToken);
  const remaining = Math.max(60, Math.round((new Date(row.linkedin_access_expires_at).getTime() - Date.now()) / 1000));
  await rememberLinkedInProfile(userId, profile, accessToken, remaining);
}

async function storeLinkedInPicture(userId: string, pictureUrl: string | undefined) {
  if (!pictureUrl?.startsWith("https://")) return;
  const current = (await pool.query("SELECT profile_image_key, profile_image_source FROM users WHERE id=$1", [userId])).rows[0];
  if (current?.profile_image_source === "upload") return;
  try {
    const response = await fetch(pictureUrl, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
    if (!response.ok || !response.url.startsWith("https://")) return;
    const ext = imageExtension(response.headers.get("content-type"), response.url);
    if (!ext) return;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > config.MAX_IMAGE_BYTES) return;
    const root = resolve(config.MEDIA_DIR);
    const key = `${userId}/${token(18)}${ext}`;
    const path = join(root, key);
    await mkdir(join(root, userId), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
    const saved = await pool.query(`UPDATE users SET profile_image_key=$2, profile_image_source='linkedin', updated_at=now()
      WHERE id=$1 AND profile_image_source IS DISTINCT FROM 'upload'`, [userId, key]);
    if (!saved.rowCount) {
      await rm(path, { force: true });
      return;
    }
    if (current?.profile_image_key) await rm(join(root, current.profile_image_key), { force: true });
  } catch {
    // The account is still usable when LinkedIn's photo cannot be saved.
  }
}
