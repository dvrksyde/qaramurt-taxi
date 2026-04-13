export const dynamic = "force-dynamic";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const access = await requireAuth();
  if (!access.allowed || access.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    if (startDateParam && endDateParam) {
      startDate = new Date(startDateParam);
      endDate = new Date(endDateParam);
      endDate.setHours(23, 59, 59, 999);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    const dateFilter = { gte: startDate, lte: endDate };

    // 1. Completed orders in range — gross revenue
    const orders = await prisma.order.findMany({
      where: { status: "completed", completedAt: dateFilter },
      select: {
        id: true,
        finalPrice: true,
        estimatedPrice: true,
        driver: { select: { id: true, firstName: true, lastName: true, callsign: true, tariffGroup: true } }
      }
    });

    const ordersCount = orders.length;
    let grossRevenue = 0;
    orders.forEach(o => { grossRevenue += Number(o.finalPrice || o.estimatedPrice || 0); });

    // 2. Real commissions from drivers — from cash_transactions (order_fee type)
    const commissionTransactions = await prisma.cashTransaction.findMany({
      where: {
        type: "order_fee",
        createdAt: dateFilter,
      },
      include: {
        driver: { select: { id: true, firstName: true, lastName: true, callsign: true, tariffGroup: true } }
      }
    });

    const totalRealCommission = commissionTransactions.reduce(
      (sum, t) => sum + Number(t.amount), 0
    );

    // 3. Per-driver breakdown
    const driverMap = new Map<number, {
      id: number; name: string; callsign: string | null;
      ordersCount: number; revenue: number; commission: number; tariffPercent: number;
    }>();

    orders.forEach(o => {
      if (!o.driver) return;
      const existing = driverMap.get(o.driver.id);
      const price = Number(o.finalPrice || o.estimatedPrice || 0);
      if (existing) {
        existing.ordersCount++;
        existing.revenue += price;
      } else {
        driverMap.set(o.driver.id, {
          id: o.driver.id,
          name: `${o.driver.lastName} ${o.driver.firstName}`,
          callsign: o.driver.callsign,
          ordersCount: 1,
          revenue: price,
          commission: 0,
          tariffPercent: Number((o.driver as any).tariffGroup?.value || 0),
        });
      }
    });

    commissionTransactions.forEach(t => {
      if (!t.driver) return;
      const entry = driverMap.get(t.driver.id);
      if (entry) {
        entry.commission += Number(t.amount);
        entry.tariffPercent = Number((t.driver as any).tariffGroup?.value || entry.tariffPercent);
      }
    });

    // 4. Operator settlements
    const settlements = await prisma.operatorSettlement.findMany({
      where: { createdAt: dateFilter },
      select: { amount: true }
    });
    const totalSettlements = settlements.reduce((sum, s) => sum + Number(s.amount), 0);

    // 5. Penalties from drivers
    const penalties = await prisma.cashTransaction.findMany({
      where: { type: "penalty", createdAt: dateFilter },
      select: { amount: true }
    });
    const totalPenalties = penalties.reduce((sum, t) => sum + Number(t.amount), 0);

    const netCompanyProfit = totalRealCommission + totalPenalties - totalSettlements;

    return NextResponse.json({
      data: {
        summary: {
          totalOrders: ordersCount,
          grossRevenue: Math.round(grossRevenue),
          // Real commissions collected from drivers
          companyCommission: Math.round(totalRealCommission),
          totalPenalties: Math.round(totalPenalties),
          totalSettlements: Math.round(totalSettlements),
          netCompanyProfit: Math.round(netCompanyProfit),
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        // Per-driver breakdown with individual tariff rates
        drivers: Array.from(driverMap.values()).map(d => ({
          ...d,
          revenue: Math.round(d.revenue),
          commission: Math.round(d.commission),
        })).sort((a, b) => b.revenue - a.revenue),
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
  }
}

