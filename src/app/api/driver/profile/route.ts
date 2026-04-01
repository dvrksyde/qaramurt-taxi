export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// GET /api/driver/profile — get driver profile
export async function GET(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const driver = await prisma.driver.findUnique({
    where: { id: auth.driverId },
    include: {
      vehicles: {
        include: { classes: { include: { class: true } } },
      },
    },
  });

  if (!driver || !driver.isActive) {
    return NextResponse.json({ error: "Водитель не найден" }, { status: 404 });
  }

  // Count today's stats
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayOrders, todayEarnings] = await Promise.all([
    prisma.order.count({
      where: { driverId: driver.id, status: "completed", completedAt: { gte: todayStart } },
    }),
    prisma.order.aggregate({
      where: { driverId: driver.id, status: "completed", completedAt: { gte: todayStart } },
      _sum: { finalPrice: true },
    }),
  ]);

  return NextResponse.json({
    data: {
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      middleName: driver.middleName,
      callsign: driver.callsign,
      phone: driver.phone,
      balance: driver.balance,
      rating: driver.rating,
      status: driver.status,
      vehicle: driver.vehicles[0] || null,
      todayOrders,
      todayEarnings: todayEarnings._sum.finalPrice || 0,
    },
  });
}
