export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// PATCH /api/driver/orders/[id]/status — update order status
// arrived → in_progress → completed
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id);
  const { status, lat, lng, distanceKm, finalPrice } = await req.json();

  // Validate status transitions
  const validStatuses = ["arrived", "in_progress", "completed", "canceled"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
  }

  // Check order belongs to this driver
  const order = await prisma.order.findFirst({
    where: { id: orderId, driverId: auth.driverId },
  });

  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  // Build update data
  const updateData: Record<string, unknown> = { status };

  if (status === "arrived") {
    updateData.arrivedAt = new Date();
  } else if (status === "in_progress") {
    updateData.startedAt = new Date();
  } else if (status === "completed") {
    updateData.completedAt = new Date();
    // Save final GPS point as dropoff
    if (lat && lng) {
      updateData.dropoffPoint = `POINT(${lng} ${lat})`;
    }
    // Save final distance and price
    if (distanceKm !== undefined) {
      updateData.distanceKm = distanceKm;
    }
    if (finalPrice !== undefined) {
      updateData.finalPrice = finalPrice;
    }
  } else if (status === "canceled") {
    updateData.canceledAt = new Date();
  }

  await prisma.order.update({
    where: { id: orderId },
    data: updateData,
  });

  // If completed or canceled — set driver back to free
  if (status === "completed" || status === "canceled") {
    await prisma.driver.update({
      where: { id: auth.driverId },
      data: { status: "free" },
    });
  }

  // Log status
  await prisma.orderStatusLog.create({
    data: { orderId, driverId: auth.driverId, status },
  });

  // Notify monitor
  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    io.to("monitor").emit("order_status_change", {
      orderId,
      status,
      driverId: auth.driverId,
      distanceKm,
      finalPrice,
    });
  }

  return NextResponse.json({ data: { orderId, status } });
}
