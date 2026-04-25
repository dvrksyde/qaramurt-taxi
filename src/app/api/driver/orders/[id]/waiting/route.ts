export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { computeWaitingTotals } from "@/lib/orderWaiting";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyDriverToken(req);
  if (!auth) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (Number.isNaN(orderId)) {
    return NextResponse.json({ error: "Некорректный ID заказа" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "start" && action !== "stop") {
    return NextResponse.json({ error: "Некорректное действие. Используйте 'start' или 'stop'." }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      driverId: auth.driverId,
    },
    include: {
      service: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  if (order.status !== "in_progress") {
    return NextResponse.json({ error: "Ожидание можно включать только во время активной поездки" }, { status: 409 });
  }

  const now = new Date();

  const updatedOrder = await prisma.$transaction(async (tx) => {
    if (action === "start") {
      if (order.isWaiting) {
        return order;
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          isWaiting: true,
          waitingStartedAt: now,
        },
        include: {
          service: { select: { id: true, name: true } },
          class: { select: { id: true, name: true } },
        },
      });
    }

    if (!order.isWaiting) {
      return order;
    }

    const totals = computeWaitingTotals(order, now);

    return tx.order.update({
      where: { id: orderId },
      data: {
        isWaiting: false,
        waitingStartedAt: null,
        waitingAccumulatedSeconds: totals.waitingAccumulatedSeconds,
        waitingFee: totals.waitingFee,
      },
      include: {
        service: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
      },
    });
  });

  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    io.to("monitor").emit("order_waiting_change", {
      orderId,
      driverId: auth.driverId,
      isWaiting: updatedOrder.isWaiting,
      waitingStartedAt: updatedOrder.waitingStartedAt,
      waitingAccumulatedSeconds: updatedOrder.waitingAccumulatedSeconds,
      waitingFee: updatedOrder.waitingFee,
    });
  }

  return NextResponse.json({ data: updatedOrder });
}
