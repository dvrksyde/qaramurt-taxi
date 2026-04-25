export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const { allowed, response } = await checkPermission(["current_orders", "admin"]);
  if (!allowed) return response!;

  const { searchParams } = new URL(req.url);
  const classId = searchParams.get("classId");
  const serviceId = searchParams.get("serviceId");

  const where: Record<string, unknown> = { isActive: true };
  if (classId) where.classId = parseInt(classId);
  if (serviceId) where.serviceId = parseInt(serviceId);

  const tariffs = await prisma.tariff.findMany({
    where,
    include: { class: true, service: true },
    orderBy: [{ serviceId: "asc" }, { classId: "asc" }],
  });

  // Fetch outOfCityKmRate via raw SQL (not in Prisma types until db push)
  const ids = tariffs.map((t) => t.id);
  const rateRows = ids.length
    ? await prisma.$queryRaw<Array<{ id: number; r: string }>>`
        SELECT id, "outOfCityKmRate" AS r FROM tariffs WHERE id = ANY(${ids}::integer[])
      `
    : [];
  const rateMap = new Map(rateRows.map((r) => [r.id, Number(r.r ?? 0)]));

  return NextResponse.json({
    data: tariffs.map((t) => ({
      ...t,
      basePrice: Number(t.basePrice),
      pricePerKm: Number(t.pricePerKm),
      pricePerMin: Number(t.pricePerMin),
      minPrice: Number(t.minPrice),
      extraWaitPrice: Number(t.extraWaitPrice),
      outOfCityKmRate: rateMap.get(t.id) ?? 0,
    })),
  });
}
