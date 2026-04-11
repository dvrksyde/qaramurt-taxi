import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface DriverJWT {
  driverId: number;
  login: string;
  iat?: number;
  exp?: number;
}

function getDriverTokenSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for driver authentication");
  }
  return secret;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getDriverTokenSecret())
    .update(encodedPayload)
    .digest("base64url");
}

/** Sign a compact bearer token for the driver app */
export function signDriverToken(payload: DriverJWT): string {
  const now = Math.floor(Date.now() / 1000);
  const encodedPayload = encodeBase64Url(
    JSON.stringify({
      driverId: payload.driverId,
      login: payload.login,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    })
  );

  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyDriverTokenString(token: string): DriverJWT | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  try {
    const expectedSignature = signPayload(encodedPayload);
    const provided = Buffer.from(signature, "base64url");
    const expected = Buffer.from(expectedSignature, "base64url");

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return null;
    }

    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as DriverJWT;
    if (
      typeof payload.driverId !== "number" ||
      typeof payload.login !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/** Verify driver token from Authorization header. Returns driverId or null. */
export function verifyDriverToken(req: NextRequest): DriverJWT | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return verifyDriverTokenString(authHeader.slice(7));
}
