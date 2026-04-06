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
    const COMMISSION_PER_ORDER = 5;
    
    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    let startDate: Date;
    let endDate: Date;

    const now = new Date();
    
    if (startDateParam && endDateParam) {
      startDate = new Date(startDateParam);
      endDate = new Date(endDateParam);
      // Make endDate inclusive of the entire day
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Default to today
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    // Fetch all completed orders in range to get prices
    const orders = await prisma.order.findMany({
      where: {
        status: "completed",
        completedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        finalPrice: true,
        estimatedPrice: true
      }
    });

    const COMPANY_COMMISSION_PERCENT = 10;
    const ordersCount = orders.length;

    let grossRevenue = 0;
    orders.forEach(o => {
      const price = Number(o.finalPrice || o.estimatedPrice || 0);
      grossRevenue += price;
    });

    const companyCommission = grossRevenue * (COMPANY_COMMISSION_PERCENT / 100);
    const siteCommission = ordersCount * COMMISSION_PER_ORDER;

    // Fetch operator settlements in range
    const settlements = await prisma.operatorSettlement.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        amount: true,
      }
    });

    const totalSettlements = settlements.reduce((sum: number, s: { amount: number | string }) => sum + Number(s.amount), 0);
    const netCompanyProfit = companyCommission - siteCommission - totalSettlements;

    return NextResponse.json({
      data: {
        summary: {
          totalOrders: ordersCount,
          grossRevenue: grossRevenue,
          companyCommission: Math.round(companyCommission),
          siteCommission: siteCommission,
          totalSettlements: Math.round(totalSettlements),
          netCompanyProfit: Math.round(netCompanyProfit),
          siteRate: COMMISSION_PER_ORDER,
          companyRatePercent: COMPANY_COMMISSION_PERCENT,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        }
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
  }
}
