export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

function buildPeriodFilter(period: string) {
  if (period === "today") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return { gte: todayStart };
  }

  if (period === "week") {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    return { gte: weekStart };
  }

  return undefined;
}

// GET /api/driver/orders/history - order history with finance summary
export async function GET(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);
  const period = searchParams.get("period") || "today";

  const completedAtFilter = buildPeriodFilter(period);

  const where: Record<string, unknown> = {
    driverId: auth.driverId,
    status: { in: ["completed", "canceled"] },
  };

  if (completedAtFilter) {
    where.completedAt = completedAtFilter;
  }

  const transactionWhere: Record<string, unknown> = {
    driverId: auth.driverId,
    type: "order_fee",
  };

  const transactionCreatedAt = buildPeriodFilter(period);
  if (transactionCreatedAt) {
    transactionWhere.createdAt = transactionCreatedAt;
  }

  const [data, total, completedSummary, canceledOrders, commissionSummary] = await Promise.all([
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
    prisma.order.aggregate({
      where: {
        driverId: auth.driverId,
        status: "completed",
        ...(completedAtFilter ? { completedAt: completedAtFilter } : {}),
      },
      _sum: { finalPrice: true },
      _count: { id: true },
    }),
    prisma.order.count({
      where: {
        driverId: auth.driverId,
        status: "canceled",
        ...(completedAtFilter ? { completedAt: completedAtFilter } : {}),
      },
    }),
    prisma.cashTransaction.aggregate({
      where: transactionWhere,
      _sum: { amount: true },
    }),
  ]);

  const grossProfit = Number(completedSummary._sum.finalPrice || 0);
  const companyCommission = Number(commissionSummary._sum.amount || 0);
  const netProfit = Math.max(0, grossProfit - companyCommission);

  return NextResponse.json({
    data,
    total,
    page,
    pageSize,
    summary: {
      grossProfit,
      companyCommission,
      netProfit,
      completedOrders: completedSummary._count.id,
      canceledOrders,
    },
  });
}
