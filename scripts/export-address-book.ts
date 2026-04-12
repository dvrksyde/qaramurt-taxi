/**
 * export-address-book.ts
 * Exports address_book table from local DB as SQL INSERT statements
 * Run: npx ts-node --project tsconfig.server.json scripts/export-address-book.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import * as fs from "fs";
import * as path from "path";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log("Connecting to local DB and exporting address_book...");

  const items = await prisma.addressBook.findMany({
    orderBy: { id: "asc" },
  });

  if (items.length === 0) {
    console.log("⚠️  Таблица address_book пустая!");
    return;
  }

  const lines: string[] = [
    "-- Exported address_book from local DB",
    `-- Total: ${items.length} records`,
    `-- Generated: ${new Date().toISOString()}`,
    "",
    "-- Clear existing data and reset sequence:",
    "TRUNCATE TABLE address_book RESTART IDENTITY CASCADE;",
    "",
    "-- Insert records:",
    "INSERT INTO address_book (id, name, full_name, latitude, longitude, is_active, created_at) VALUES",
  ];

  const rows = items.map((item, i) => {
    const name = item.name.replace(/'/g, "''");
    const fullName = item.fullName ? `'${item.fullName.replace(/'/g, "''")}'` : "NULL";
    const lat = Number(item.latitude).toFixed(7);
    const lng = Number(item.longitude).toFixed(7);
    const active = item.isActive ? "true" : "false";
    const createdAt = item.createdAt.toISOString();
    const comma = i < items.length - 1 ? "," : ";";
    return `  (${item.id}, '${name}', ${fullName}, ${lat}, ${lng}, ${active}, '${createdAt}')${comma}`;
  });

  lines.push(...rows);
  lines.push("");
  lines.push("-- Reset sequence to continue from max id:");
  lines.push(`SELECT setval('address_book_id_seq', (SELECT MAX(id) FROM address_book));`);

  const outPath = path.join(process.cwd(), "address_book_export.sql");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");

  console.log(`✅ Exported ${items.length} records to: ${outPath}`);
  console.log("\nПреview (first 3 rows):");
  items.slice(0, 3).forEach(item => {
    console.log(`  [${item.id}] "${item.name}" | ${item.fullName || "—"} | ${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}`);
  });
  console.log("\n👆 Теперь скопируйте содержимое address_book_export.sql");
  console.log("   и выполните его в Supabase SQL Editor или psql на сервере.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
