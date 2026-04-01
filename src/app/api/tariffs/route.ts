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

  return NextResponse.json({
    data: tariffs.map((t) => ({
      ...t,
      basePrice: Number(t.basePrice),
      pricePerKm: Number(t.pricePerKm),
      pricePerMin: Number(t.pricePerMin),
      minPrice: Number(t.minPrice),
      extraWaitPrice: Number(t.extraWaitPrice),
    })),
  });
}
