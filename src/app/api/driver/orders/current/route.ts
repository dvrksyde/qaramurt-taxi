export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// GET /api/driver/orders/current — get current active order
export async function GET(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const order = await prisma.order.findFirst({
    where: {
      driverId: auth.driverId,
      status: { in: ["assigned", "arrived", "in_progress"] },
    },
    include: {
      service: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: order });
}
