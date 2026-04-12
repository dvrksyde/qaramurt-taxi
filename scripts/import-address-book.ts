/**
 * import-address-book.ts
 * Sends local address book data to the production server via HTTP API.
 *
 * HOW TO USE:
 *   1. Make sure you are logged in as admin on the production server
 *   2. Set PROD_URL and PROD_COOKIE in this file (or via env vars)
 *   3. Run: npx ts-node --project tsconfig.server.json scripts/import-address-book.ts
 *
 * How to get the cookie:
 *   - Open https://qaramurttaxi.onrender.com in browser
 *   - Log in as admin
 *   - Open DevTools → Application → Cookies → copy the value of "next-auth.session-token"
 */

import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

// ─── CONFIGURE THESE ──────────────────────────────────────────────────────────
const PROD_URL = process.env.PROD_URL || "https://qaramurttaxi.onrender.com";
const PROD_COOKIE = process.env.PROD_COOKIE || ""; // next-auth.session-token=...
// ──────────────────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  if (!PROD_COOKIE) {
    console.error("❌ PROD_COOKIE is not set!");
    console.log("\nКак получить cookie:");
    console.log("1. Откройте https://qaramurttaxi.onrender.com и войдите как admin");
    console.log("2. DevTools (F12) → Application → Cookies → qaramurttaxi.onrender.com");
    console.log("3. Найдите __Secure-next-auth.session-token (или next-auth.session-token)");
    console.log("4. Скопируйте ТОЛЬКО ЗНАЧЕНИЕ (не имя!)");
    console.log('5. Запустите: $env:PROD_COOKIE="ЗНАЧЕНИЕ"; npx ts-node ...');
    process.exit(1);
  }

  // On HTTPS, NextAuth uses __Secure- prefixed cookie
  const isHttps = PROD_URL.startsWith("https://");
  const cookieName = isHttps ? "__Secure-next-auth.session-token" : "next-auth.session-token";
  
  // If user passed just the token value (no "name=value"), wrap it
  const cookieHeader = PROD_COOKIE.includes("=")
    ? PROD_COOKIE  // already "name=value" format
    : `${cookieName}=${PROD_COOKIE}`;  // just the token value

  console.log(`🍪 Using cookie: ${cookieName}=...`);


  console.log("📦 Reading local address book...");
  const items = await prisma.addressBook.findMany({ orderBy: { id: "asc" } });

  if (items.length === 0) {
    console.log("⚠️  Local address book is empty!");
    return;
  }

  console.log(`✅ Found ${items.length} records in local DB`);
  console.log(`🚀 Sending to ${PROD_URL}/api/address-book/import ...`);

  const payload = {
    truncate: true,
    data: items.map(item => ({
      name: item.name,
      fullName: item.fullName || null,
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      isActive: item.isActive,
    })),
  };

  const res = await fetch(`${PROD_URL}/api/address-book/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookieHeader,
    },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  if (!res.ok) {
    console.error("❌ Server error:", result);
  } else {
    console.log(`\n✅ Import complete!`);
    console.log(`   Inserted: ${result.inserted}`);
    console.log(`   Skipped:  ${result.skipped}`);
    console.log(`   Total:    ${result.total}`);
  }

  await pool.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
