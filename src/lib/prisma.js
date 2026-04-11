"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
exports.getPrisma = getPrisma;
/**
 * Lazy Prisma client singleton for Prisma v7 + Next.js 16 compatibility.
 */
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
// Next.js requires DATABASE_URL to be available. In seed script, dotenv gives it.
const connectionString = process.env.DATABASE_URL;
function getPrisma() {
    if (!global.__prisma) {
        if (!connectionString)
            throw new Error("DATABASE_URL is missing");
        const pool = new pg_1.Pool({ connectionString });
        const adapter = new adapter_pg_1.PrismaPg(pool);
        global.__prisma = new client_1.PrismaClient({ adapter });
    }
    return global.__prisma;
}
// Also export a lazy proxy for convenience
exports.prisma = new Proxy({}, {
    get(_target, prop) {
        return getPrisma()[prop];
    },
});
