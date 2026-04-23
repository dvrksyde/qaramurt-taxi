export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { isDeliveryOrder } from "@/lib/orderPricing";

const BASE_FARE = 290;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id, 10);
  if (Number.isNaN(orderId)) {
    return NextResponse.json({ error: "Некорректный ID заказа" }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, driverId: auth.driverId },
    include: { service: true, class: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  if (isDeliveryOrder(order)) {
    return NextResponse.json(
      { error: "Для доставки серверная сессия GPS-трека не требуется" },
      { status: 400 }
    );
  }

  if (!["assigned", "arrived", "in_progress"].includes(order.status)) {
    return NextResponse.json(
      { error: "Сессию поездки можно начать только для активного заказа" },
      { status: 409 }
    );
  }

  const existingSession = await prisma.orderTripSession.findFirst({
    where: {
      orderId,
      driverId: auth.driverId,
      status: "active",
    },
    orderBy: { startedAt: "desc" },
  });

  if (existingSession) {
    return NextResponse.json({
      data: {
        sessionId: existingSession.id,
        status: existingSession.status,
        pointsReceived: existingSession.pointsReceived,
        lastSequenceNumber: existingSession.lastSequenceNumber,
        startedAt: existingSession.startedAt,
      },
    });
  }

  let currentBaseFare = order.class?.name === "Комфорт" ? 390 : BASE_FARE;
  if (order.arrivedAt) {
    const startedAtTime = order.startedAt ? order.startedAt.getTime() : Date.now();
    const waitMs = startedAtTime - order.arrivedAt.getTime();
    const waitMins = Math.floor(waitMs / 60000);
    if (waitMins > 3) {
      currentBaseFare += (waitMins - 3) * 20;
    }
  }

  const session = await prisma.orderTripSession.create({
    data: {
      orderId,
      driverId: auth.driverId,
      tariffPerKm: order.pricePerKm,
      baseFare: currentBaseFare,
      startedAt: order.startedAt ?? new Date(),
      status: "active",
    },
  });

  return NextResponse.json({
    data: {
      sessionId: session.id,
      status: session.status,
      pointsReceived: session.pointsReceived,
      lastSequenceNumber: session.lastSequenceNumber,
      startedAt: session.startedAt,
    },
  });
}
