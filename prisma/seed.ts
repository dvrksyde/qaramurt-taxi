/**
 * Qaramurt Taxi — Database Seed
 * Run: npx ts-node prisma/seed.ts
 */
import "dotenv/config";
import { getPrisma } from "../src/lib/prisma";

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
    prisma.vehicleClass.upsert({ where: { id: 3 }, update: {}, create: { groupId: group.id, name: "Бизнес", icon: "business", sortOrder: 3 } }),
    prisma.vehicleClass.upsert({ where: { id: 4 }, update: {}, create: { groupId: group.id, name: "Минивэн", icon: "minivan", sortOrder: 4 } }),
  ]);
  console.log("✓ Vehicle classes:", classes.map((c) => c.name).join(", "));

  // ── Tariffs ────────────────────────────────────────────────────────────────
  const tariffs = await Promise.all(
    classes.map((cls) =>
      prisma.tariff.upsert({
        where: { id: cls.id },
        update: {},
        create: {
          serviceId: service.id,
          classId: cls.id,
          name: `${cls.name} — Стандарт`,
          basePrice: cls.id === 1 ? 150 : cls.id === 2 ? 200 : cls.id === 3 ? 350 : 280,
          pricePerKm: cls.id === 1 ? 20 : cls.id === 2 ? 25 : cls.id === 3 ? 40 : 32,
          pricePerMin: cls.id === 1 ? 3 : cls.id === 2 ? 4 : cls.id === 3 ? 6 : 5,
          minPrice: cls.id === 1 ? 150 : cls.id === 2 ? 200 : cls.id === 3 ? 350 : 280,
          freeWaitMinutes: 5,
          extraWaitPrice: 5,
        },
      })
    )
  );
  console.log("✓ Tariffs:", tariffs.length);

  // ── Vehicle Options ────────────────────────────────────────────────────────
  const options = await Promise.all([
    prisma.vehicleOption.upsert({ where: { id: 1 }, update: {}, create: { name: "Детское кресло", priceModifier: 50 } }),
    prisma.vehicleOption.upsert({ where: { id: 2 }, update: {}, create: { name: "Животные", priceModifier: 100 } }),
    prisma.vehicleOption.upsert({ where: { id: 3 }, update: {}, create: { name: "Без запаха", priceModifier: 0 } }),
    prisma.vehicleOption.upsert({ where: { id: 4 }, update: {}, create: { name: "Кондиционер", priceModifier: 0 } }),
  ]);
  console.log("✓ Vehicle options:", options.length);

  // ── Driver Tariff Group ────────────────────────────────────────────────────
  await prisma.driverTariffGroup.upsert({
    where: { id: 1 },
    update: {},
    create: { name: "Сдельная 15%", type: "commission", value: 15, description: "Комиссия 15% с каждого заказа" },
  });
  await prisma.driverTariffGroup.upsert({
    where: { id: 2 },
    update: {},
    create: { name: "Безлимит 2500₽/неделя", type: "unlimited", value: 2500, description: "Фиксированный платёж 2500р/нед" },
  });
  console.log("✓ Tariff groups: 2");

  // ── Admin Operator ─────────────────────────────────────────────────────────
  const admin = await prisma.operator.upsert({
    where: { login: "admin" },
    update: {},
    create: {
      login: "admin",
      name: "Администратор",
      passwordHash: "admin123", // In production: use bcrypt hash
      role: "admin",
      cashBalance: 0,
      advanceBalance: 0,
      isActive: true,
    },
  });
  console.log("✓ Admin operator:", admin.login);

  // ── Demo Driver ────────────────────────────────────────────────────────────
  const driver = await prisma.driver.upsert({
    where: { login: "driver001" },
    update: {},
    create: {
      login: "driver001",
      passwordHash: "driver123",
      firstName: "Асхат",
      lastName: "Жумабеков",
      phone: "+77001234567",
      callsign: "001",
      status: "offline",
      balance: 0,
      rating: 4.8,
      isActive: true,
    },
  });
  console.log("✓ Demo driver:", driver.login);

  // ── Demo Vehicle ───────────────────────────────────────────────────────────
  await prisma.vehicle.upsert({
    where: { plate: "777AAA01" },
    update: {},
    create: {
      plate: "777AAA01",
      make: "Toyota",
      model: "Camry",
      color: "белый",
      year: 2020,
      ownershipType: "driver",
      driverId: driver.id,
      isActive: true,
    },
  });
  console.log("✓ Demo vehicle: 777AAA01");

  console.log("\n✅ Seed complete!");
  console.log("   Login: admin / admin123");
  console.log("   Driver app: driver001 / driver123");
}

main()
  .catch((e) => { console.error("Seed failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
