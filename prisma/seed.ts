/**
 * Qaramurt Taxi — Database Seed
 * Run: npx ts-node prisma/seed.ts
 */
import "dotenv/config";
import { getPrisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/passwords";

const prisma = getPrisma();

async function main() {
  console.log("🌱 Seeding database...");

  // ── Taxi Services ─────────────────────────────────────────────────────────
  const service = await prisma.taxiService.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name: "Qaramurt Taxi",
      priority: 10,
      settlement: "Город",
      autoSelectionType: "nearest",
      isActive: true,
    },
  });
  console.log("✓ TaxiService:", service.name);

  const deliveryService = await prisma.taxiService.upsert({
    where: { id: 2 },
    update: {},
    create: {
      name: "Доставка",
      priority: 9,
      settlement: "Город",
      autoSelectionType: "nearest",
      isActive: true,
    },
  });
  console.log("✓ TaxiService:", deliveryService.name);

  // ── Vehicle Class Group ────────────────────────────────────────────────────
  const group = await prisma.vehicleClassGroup.upsert({
    where: { id: 1 },
    update: {},
    create: { name: "Основные классы", sortOrder: 1 },
  });

  // ── Vehicle Classes ────────────────────────────────────────────────────────
  const classes = await Promise.all([
    prisma.vehicleClass.upsert({ where: { id: 1 }, update: {}, create: { groupId: group.id, name: "Эконом", icon: "economy", sortOrder: 1 } }),
    prisma.vehicleClass.upsert({ where: { id: 2 }, update: {}, create: { groupId: group.id, name: "Комфорт", icon: "comfort", sortOrder: 2 } }),
  ]);
  console.log("✓ Vehicle classes:", classes.map((c) => c.name).join(", "));

  // ── Tariffs ────────────────────────────────────────────────────────────────
  // Rates: Эконом 80₸/km city / 120₸/km out-of-city
  //        Комфорт 100₸/km city / 140₸/km out-of-city
  const TARIFF_DATA: Record<number, { base: number; city: number; outCity: number; min: number }> = {
    1: { base: 290, city: 80, outCity: 120, min: 290 }, // Эконом
    2: { base: 390, city: 100, outCity: 140, min: 390 }, // Комфорт
  };

  const tariffs = await Promise.all(
    classes.map((cls) => {
      const d = TARIFF_DATA[cls.id] ?? { base: 290, city: 80, outCity: 120, min: 290 };
      const data = {
        serviceId: service.id,
        classId: cls.id,
        name: `${cls.name}`,
        basePrice: d.base,
        pricePerKm: d.city,
        pricePerMin: 0,
        minPrice: d.min,
        freeWaitMinutes: 5,
        extraWaitPrice: 5,
      };
      return prisma.tariff.upsert({
        where: { id: cls.id },
        update: data, // ← обновляем существующие записи
        create: data,
      });
    })
  );
  console.log("✓ Tariffs:", tariffs.length);

  // Set outOfCityKmRate via raw SQL (new field, might not exist before db:push)
  try {
    for (const cls of classes) {
      const d = TARIFF_DATA[cls.id];
      if (!d) continue;
      await prisma.$executeRaw`
        UPDATE tariffs SET "outOfCityKmRate" = ${d.outCity}
        WHERE "classId" = ${cls.id} AND "serviceId" = ${service.id}
      `;
    }
    console.log("✓ outOfCityKmRate updated");
  } catch {
    console.log("⚠ outOfCityKmRate column not yet created — run db:push first");
  }

  main()
    .catch((e) => { console.error("Seed failed:", e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
}