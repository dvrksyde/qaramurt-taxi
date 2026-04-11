export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id, 10);
  const { status, lat, lng, distanceKm, finalPrice } = await req.json();

  const validStatuses = ["arrived", "in_progress", "completed", "canceled"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, driverId: auth.driverId },
    include: { service: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

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

  await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: updateData,
    });

    const operatorId = 1;

    if (status === "completed" && updatedOrder.finalPrice) {
      const dTG = await tx.driver.findUnique({
        where: { id: auth.driverId },
        include: { tariffGroup: true }
      });
      const commPercent = Number(dTG?.tariffGroup?.value || 15);
      const commission = Number(updatedOrder.finalPrice) * (commPercent / 100);

      if (commission > 0) {
        await tx.driver.update({
          where: { id: auth.driverId },
          data: { balance: { decrement: commission } },
        });
        await tx.cashTransaction.create({
          data: {
            driverId: auth.driverId,
            operatorId,
            orderId,
            amount: commission,
            type: "order_fee",
            description: `Комиссия ${commPercent}% за заказ #${orderId}`,
          },
        });
      }
    }

    if (status === "canceled") {
      const penalty = 50;
      await tx.driver.update({
        where: { id: auth.driverId },
        data: { balance: { decrement: penalty } },
      });
      await tx.cashTransaction.create({
        data: {
          driverId: auth.driverId,
          operatorId,
          orderId,
          amount: penalty,
          type: "penalty",
          description: `Штраф за отмену заказа #${orderId}`,
        },
      });
    }

    if (status === "completed" || status === "canceled") {
      await tx.driver.update({
        where: { id: auth.driverId },
        data: { status: "free" },
      });
    }
  });

  await prisma.orderStatusLog.create({
    data: { orderId, driverId: auth.driverId, status },
  });

  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    io.to("monitor").emit("order_status_change", {
      orderId,
      status,
      driverId: auth.driverId,
      distanceKm,
      finalPrice,
    });

    if (status === "completed") {
      io.to("monitor").emit("driver_ratings_updated", { driverId: auth.driverId, orderId });
      io.to("drivers").emit("driver_ratings_updated", { driverId: auth.driverId, orderId });
      io.to(`driver:${auth.driverId}`).emit("driver_ratings_updated", { driverId: auth.driverId, orderId });
    }
  }

  return NextResponse.json({ data: { orderId, status } });
}
