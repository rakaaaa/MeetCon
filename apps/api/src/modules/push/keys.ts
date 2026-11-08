import { createECDH, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { config } from "../../config.js";

const webpush = createRequire(import.meta.url)("web-push") as typeof import("web-push");

function deriveVapidKeys(secret: string) {
  for (let counter = 0; counter < 8; counter++) {
    const ecdh = createECDH("prime256v1");
    try {
      ecdh.setPrivateKey(createHash("sha256").update(`meetplus:vapid:v1:${counter}:${secret}`).digest());
      return {
        publicKey: ecdh.getPublicKey(null, "uncompressed").toString("base64url"),
        privateKey: ecdh.getPrivateKey().toString("base64url"),
      };
    } catch {
      continue;
    }
  }
  throw new Error("Unable to derive the push signing key");
}

const keys = deriveVapidKeys(config.TOKEN_ENCRYPTION_KEY);
webpush.setVapidDetails("mailto:no-reply@meetcon.local", keys.publicKey, keys.privateKey);

export const pushPublicKey = () => keys.publicKey;
