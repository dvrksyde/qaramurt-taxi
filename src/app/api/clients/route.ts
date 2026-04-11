export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

// GET /api/clients — list with filters, sorting, and order stats
export async function GET(req: NextRequest) {
  const { allowed, response } = await checkPermission(["clients"]);
  if (!allowed) return response!;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");
  const sortBy = searchParams.get("sortBy") || "id"; // id | firstOrder | completed
  const sortDir = searchParams.get("sortDir") || "asc"; // asc | desc

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { phone: { contains: search } },
      { name: { contains: search, mode: "insensitive" } },
    ];
  }

  // For DB-level sorts (id) we can use Prisma orderBy; for computed fields we sort in JS
  const dbOrderBy: Record<string, string> = {};
  if (sortBy === "id") dbOrderBy.id = sortDir;
  else dbOrderBy.id = "asc"; // default fallback, we'll re-sort in JS

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      select: {
        id: true,
        phone: true,
        name: true,
        createdAt: true,
        isBlacklisted: true,
        _count: {
          select: { orders: true },
        },
        orders: {
          select: {
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: dbOrderBy,
    }),
    prisma.client.count({ where }),
  ]);

  // Compute order stats for each client
  let data = clients.map((c) => {
    const totalOrders = c._count.orders;
    const completedOrders = c.orders.filter((o) => o.status === "completed").length;
    const canceledOrders = c.orders.filter((o) => o.status === "canceled").length;
    const firstOrderDate = c.orders.length > 0 ? c.orders[0].createdAt : null;

    return {
      id: c.id,
      phone: c.phone,
      name: c.name,
      isBlacklisted: c.isBlacklisted,
      firstOrderDate,
      totalOrders,
      completedOrders,
      canceledOrders,
    };
  });

  // Sort by computed fields
  if (sortBy === "firstOrder") {
    data.sort((a, b) => {
      const aDate = a.firstOrderDate ? new Date(a.firstOrderDate).getTime() : 0;
      const bDate = b.firstOrderDate ? new Date(b.firstOrderDate).getTime() : 0;
      return sortDir === "asc" ? aDate - bDate : bDate - aDate;
    });
  } else if (sortBy === "completed") {
    data.sort((a, b) => {
      return sortDir === "asc"
        ? a.completedOrders - b.completedOrders
        : b.completedOrders - a.completedOrders;
    });
  } else if (sortBy === "total") {
    data.sort((a, b) => {
      return sortDir === "asc"
        ? a.totalOrders - b.totalOrders
        : b.totalOrders - a.totalOrders;
    });
  } else if (sortBy === "canceled") {
    data.sort((a, b) => {
      return sortDir === "asc"
        ? a.canceledOrders - b.canceledOrders
        : b.canceledOrders - a.canceledOrders;
    });
  }

  return NextResponse.json({ data, total });
}
