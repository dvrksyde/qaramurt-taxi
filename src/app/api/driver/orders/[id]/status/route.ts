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
    include: { service: true }
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
    if (lat && lng) updateData.dropoffPoint = `POINT(${lng} ${lat})`;
    if (distanceKm !== undefined) updateData.distanceKm = distanceKm;
    if (finalPrice !== undefined) updateData.finalPrice = finalPrice;
  } else if (status === "canceled") {
    updateData.canceledAt = new Date();
  }

  // Use transaction to atomize status update and balance deduction
  await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: updateData,
    });

    const operatorId = 1; // System/Default operator for automatic driver actions

    // 1. Commission (10%)
    if (status === "completed" && updatedOrder.finalPrice) {
      const commission = Number(updatedOrder.finalPrice) * 0.1;
      if (commission > 0) {
        await tx.driver.update({
          where: { id: auth.driverId },
          data: { balance: { decrement: commission } }
        });
        await tx.cashTransaction.create({
          data: {
            driverId: auth.driverId,
            operatorId,
            orderId,
            amount: commission,
            type: "order_fee",
            description: `Комиссия 10% за заказ #${orderId} (завершил водитель)`
          }
        });
      }
    }

    // 2. Penalty (50 тг)
    if (status === "canceled") {
      const penalty = 50;
      await tx.driver.update({
        where: { id: auth.driverId },
        data: { balance: { decrement: penalty } }
      });
      await tx.cashTransaction.create({
        data: {
          driverId: auth.driverId,
          operatorId,
          orderId,
          amount: penalty,
          type: "penalty",
          description: `Штраф за отмену заказа #${orderId} водителем`
        }
      });
    }

    // Set driver status to free if order ends
    if (status === "completed" || status === "canceled") {
      await tx.driver.update({
        where: { id: auth.driverId },
        data: { status: "free" },
      });
    }
  });

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
