export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
