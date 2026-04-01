export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// POST /api/driver/orders/[id]/accept — accept an order (first-come-first-served)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id);

  // Atomic: only assign if status is still "pending"
  // This ensures first-come-first-served — only one driver can grab it
  const result = await prisma.order.updateMany({
    where: { id: orderId, status: "pending" },
    data: {
      driverId: auth.driverId,
      status: "assigned",
      assignedAt: new Date(),
    },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Заказ уже занят" }, { status: 409 });
  }

  // Update driver status to busy
  await prisma.driver.update({
    where: { id: auth.driverId },
    data: { status: "busy" },
  });

  // Log status change
  await prisma.orderStatusLog.create({
    data: { orderId, driverId: auth.driverId, status: "assigned" },
  });

  // Get full order for response
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      service: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
    },
  });

  // Notify everyone
  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    // Tell monitor
    io.to("monitor").emit("order_status_change", {
      orderId,
      status: "assigned",
      driverId: auth.driverId,
    });
    // Tell all other drivers the order is taken
    io.to("drivers").emit("order_taken", { orderId });
  }

  return NextResponse.json({ data: order });
}
