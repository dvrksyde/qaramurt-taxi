export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// GET /api/driver/orders/available — get pending (unassigned) orders
export async function GET(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Only show orders from the last 15 minutes
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      status: "pending",
      driverId: null,
      createdAt: { gte: fifteenMinutesAgo },
    },
    select: {
      id: true,
      phone: true,
      pickupAddress: true,
      dropoffAddress: true,
      pricePerKm: true,
      createdAt: true,
      comment: true,
      service: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ data: orders });
}
