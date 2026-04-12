export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export async function GET() {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  try {
    console.log("Seeding basic system tables via API...");

    // 1. Taxi Services
    const service = await prisma.taxiService.upsert({
      where: { id: 1 },
      update: {},
      create: {
        name: "Qaramurt Taxi",
        priority: 10,
        settlement: "Город",
        autoSelectionType: "nearest",
        isActive: true, // Make sure to provide basic fields
      },
    });

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

    // 2. Vehicle Class Group
    const group = await prisma.vehicleClassGroup.upsert({
      where: { id: 1 },
      update: {},
      create: { name: "Основные классы", sortOrder: 1 },
    });

    // 3. Vehicle Classes
    const classes = await Promise.all([
      prisma.vehicleClass.upsert({ where: { id: 1 }, update: {}, create: { groupId: group.id, name: "Эконом", icon: "economy", sortOrder: 1 } }),
      prisma.vehicleClass.upsert({ where: { id: 2 }, update: {}, create: { groupId: group.id, name: "Комфорт", icon: "comfort", sortOrder: 2 } }),
      prisma.vehicleClass.upsert({ where: { id: 3 }, update: {}, create: { groupId: group.id, name: "Бизнес", icon: "business", sortOrder: 3 } }),
      prisma.vehicleClass.upsert({ where: { id: 4 }, update: {}, create: { groupId: group.id, name: "Минивэн", icon: "minivan", sortOrder: 4 } }),
    ]);

    // 4. Tariffs
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

    // 5. Options
    const options = await Promise.all([
      prisma.vehicleOption.upsert({ where: { id: 1 }, update: {}, create: { name: "Детское кресло", priceModifier: 50 } }),
      prisma.vehicleOption.upsert({ where: { id: 2 }, update: {}, create: { name: "Животные", priceModifier: 100 } }),
      prisma.vehicleOption.upsert({ where: { id: 3 }, update: {}, create: { name: "Без запаха", priceModifier: 0 } }),
      prisma.vehicleOption.upsert({ where: { id: 4 }, update: {}, create: { name: "Кондиционер", priceModifier: 0 } }),
    ]);

    return NextResponse.json({
      message: "Базовые таблицы успешно восстановлены!",
      services: [service, deliveryService],
      classes,
      tariffs,
      options
    });

  } catch (error: any) {
    console.error("Seed error", error);
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}
