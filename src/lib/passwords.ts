import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

function serializeHash(salt: Buffer, derivedKey: Buffer): string {
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return serializeHash(salt, derivedKey);
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!storedHash.startsWith("scrypt$")) {
    return { valid: password === storedHash, needsRehash: password === storedHash };
  }

  const [, saltHex, hashHex] = storedHash.split("$");
  if (!saltHex || !hashHex) {
    return { valid: false, needsRehash: false };
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;

  if (derived.length !== expected.length) {
    return { valid: false, needsRehash: false };
  }

  return {
    valid: timingSafeEqual(derived, expected),
    needsRehash: false,
  };
}
