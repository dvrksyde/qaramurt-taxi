/**
 * Refined import script using Prisma custom adapter for compatibility.
 */
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is missing in .env");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Reliable CSV parser that handles quoted fields with commas.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

async function main() {
  const csvPath = path.join(process.cwd(), "adresses.csv");
  if (!fs.existsSync(csvPath)) {
    console.error(`Error: File not found at ${csvPath}`);
    process.exit(1);
  }

  console.log("Reading adresses.csv...");
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split(/\r?\n/);
  
  // Skip header "название,официальное название,координаты"
  const dataLines = lines.slice(1).filter(l => l.trim() !== "");

  console.log(`Processing ${dataLines.length} addresses...`);

  let count = 0;
  for (const line of dataLines) {
    const parts = parseCsvLine(line);
    if (parts.length < 3) {
      console.warn(`Skipping invalid line: ${line}`);
      continue;
    }

    const name = parts[0];
    const fullNameRaw = parts[1];
    const coordsRaw = parts[2];
    
    const fullName = fullNameRaw === "-" ? "" : fullNameRaw;
    const [latStr, lngStr] = coordsRaw.split(",").map(s => s.trim());
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    if (isNaN(lat) || isNaN(lng)) {
      console.warn(`Skipping line with invalid coordinates: ${line}`);
      continue;
    }

    try {
      // Find existing record by name
      const existing = await prisma.addressBook.findFirst({
        where: { name: name }
      });

      if (existing) {
        await prisma.addressBook.update({
          where: { id: existing.id },
          data: {
            fullName,
            latitude: lat,
            longitude: lng,
          }
        });
        console.log(`Updated: ${name}`);
      } else {
        await prisma.addressBook.create({
          data: {
            name,
            fullName,
            latitude: lat,
            longitude: lng,
          }
        });
        console.log(`Created: ${name}`);
      }
      count++;
    } catch (error) {
      console.error(`Error processing "${name}":`, error);
    }
  }

  console.log(`\nImport finished! Processed ${count} records.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
