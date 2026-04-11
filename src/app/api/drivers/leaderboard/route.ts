export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday...
  const diffToMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - diffToMonday);

  // Helper to fetch Top 5
  const getTopDrivers = async (startDate: Date) => {
    const stats = await prisma.order.groupBy({
      by: ["driverId"],
      where: {
        status: "completed",
        completedAt: { gte: startDate },
        driverId: { not: null },
      },
      _count: { id: true },
      _sum: { finalPrice: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    });

    // Populate driver info and calculate Net Income
    const populated = await Promise.all(
      stats.map(async (st) => {
        const driverId = st.driverId!;
        
        // Fetch total commissions for these orders
        const fees = await prisma.cashTransaction.aggregate({
          where: {
            driverId: driverId,
            type: "order_fee",
            createdAt: { gte: startDate },
            // Ensure we only count fees for completed orders
            order: {
              status: "completed",
              completedAt: { gte: startDate }
            }
          },
          _sum: { amount: true }
        });

        const d = await prisma.driver.findUnique({
          where: { id: driverId },
          select: { firstName: true, lastName: true, callsign: true },
        });

        const gross = Number(st._sum.finalPrice || 0);
        const commission = Number(fees._sum.amount || 0);
        const net = Math.max(0, gross - commission);

        return {
          id: driverId,
          name: `${d?.lastName || ""} ${d?.firstName || ""}`.trim(),
          callsign: d?.callsign,
          ordersCount: st._count.id,
          totalEarnings: net, // Now it's Clean Earnings
        };
      })
    );
    return populated;
  };

  try {
    const [today, week] = await Promise.all([
      getTopDrivers(startOfToday),
      getTopDrivers(startOfWeek),
    ]);

    return NextResponse.json({ today, week });
  } catch (error) {
    console.error("Leaderboard Error:", error);
    return NextResponse.json({ error: "Ошибка при загрузке рейтинга" }, { status: 500 });
  }
}
