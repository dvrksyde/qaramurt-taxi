import { prisma } from './src/lib/prisma';

async function main() {
  console.log("Seeding driver tariffs...");

  const defaultTariffs = [
    { name: "Бренд", type: "commission", value: 10, description: "Скидка для брендированных авто" },
    { name: "Стандарт", type: "commission", value: 15, description: "Стандартный тариф" },
    { name: "Старший", type: "commission", value: 5, description: "Особый тариф" },
  ];

  for (const t of defaultTariffs) {
    const existing = await prisma.driverTariffGroup.findFirst({ where: { name: t.name } });
    if (!existing) {
      await prisma.driverTariffGroup.create({ data: t as any });
    }
  }

  const standard = await prisma.driverTariffGroup.findFirst({ where: { name: "Стандарт" } });
  if (standard) {
    const res = await prisma.driver.updateMany({
      where: { tariffGroupId: null },
      data: { tariffGroupId: standard.id },
    });
    console.log(`Updated ${res.count} drivers to "Стандарт" tariff.`);
  }

  console.log("Done.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
