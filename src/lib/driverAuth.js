"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signDriverToken = signDriverToken;
exports.verifyDriverTokenString = verifyDriverTokenString;
exports.verifyDriverToken = verifyDriverToken;
const crypto_1 = require("crypto");
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
function getDriverTokenSecret() {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
        throw new Error("NEXTAUTH_SECRET is required for driver authentication");
    }
    return secret;
}
function encodeBase64Url(value) {
    return Buffer.from(value, "utf8").toString("base64url");
}
function decodeBase64Url(value) {
    return Buffer.from(value, "base64url").toString("utf8");
}
function signPayload(encodedPayload) {
    return (0, crypto_1.createHmac)("sha256", getDriverTokenSecret())
        .update(encodedPayload)
        .digest("base64url");
}
/** Sign a compact bearer token for the driver app */
function signDriverToken(payload) {
    const now = Math.floor(Date.now() / 1000);
    const encodedPayload = encodeBase64Url(JSON.stringify({
        driverId: payload.driverId,
        login: payload.login,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
    }));
    return `${encodedPayload}.${signPayload(encodedPayload)}`;
}
function verifyDriverTokenString(token) {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature)
        return null;
    try {
        const expectedSignature = signPayload(encodedPayload);
        const provided = Buffer.from(signature, "base64url");
        const expected = Buffer.from(expectedSignature, "base64url");
        if (provided.length !== expected.length ||
            !(0, crypto_1.timingSafeEqual)(provided, expected)) {
            return null;
        }
        const payload = JSON.parse(decodeBase64Url(encodedPayload));
        if (typeof payload.driverId !== "number" ||
            typeof payload.login !== "string" ||
            typeof payload.exp !== "number" ||
            payload.exp <= Math.floor(Date.now() / 1000)) {
            return null;
        }
        return payload;
    }
    catch {
        return null;
    }
}
/** Verify driver token from Authorization header. Returns driverId or null. */
function verifyDriverToken(req) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer "))
        return null;
    return verifyDriverTokenString(authHeader.slice(7));
}
