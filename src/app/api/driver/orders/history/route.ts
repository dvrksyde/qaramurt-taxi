export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// GET /api/driver/orders/history — order history
export async function GET(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "20");
  const period = searchParams.get("period") || "today"; // today, week, all

  const where: Record<string, unknown> = {
    driverId: auth.driverId,
    status: { in: ["completed", "canceled"] },
  };

  if (period === "today") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    where.completedAt = { gte: todayStart };
  } else if (period === "week") {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    where.completedAt = { gte: weekStart };
  }

  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        pickupAddress: true,
        dropoffAddress: true,
        distanceKm: true,
        pricePerKm: true,
        finalPrice: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ data, total, page, pageSize });
}
