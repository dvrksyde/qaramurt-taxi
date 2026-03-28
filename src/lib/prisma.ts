/**
 * Lazy Prisma client singleton for Prisma v7 + Next.js 16 compatibility.
 */
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

// Next.js requires DATABASE_URL to be available. In seed script, dotenv gives it.
const connectionString = process.env.DATABASE_URL;

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export function getPrisma(): PrismaClient {
  if (!global.__prisma) {
    if (!connectionString) throw new Error("DATABASE_URL is missing");
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    global.__prisma = new PrismaClient({ adapter });
  }
  return global.__prisma;
}

// Also export a lazy proxy for convenience
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return getPrisma()[prop as keyof PrismaClient];
  },
});
