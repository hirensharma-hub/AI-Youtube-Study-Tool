import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

import { env } from "@/lib/env";

function getKey() {
  return createHash("sha256").update(env.encryptionSecret).digest();
}

export function encryptSecret(plainText: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64url"), encrypted.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decryptSecret(cipherText: string) {
  const [iv, encrypted, tag] = cipherText.split(".");
  if (!iv || !encrypted || !tag) {
    throw new Error("Malformed encrypted secret.");
  }

  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

