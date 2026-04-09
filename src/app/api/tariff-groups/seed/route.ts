import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
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
  let count = 0;
  if (standard) {
    const res = await prisma.driver.updateMany({
      where: { tariffGroupId: null },
      data: { tariffGroupId: standard.id },
    });
    count = res.count;
  }

  return NextResponse.json({ success: true, updatedDrivers: count });
}
