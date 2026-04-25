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
    include: { service: true, class: true, tariff: true },
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

  // Out-of-city rate via raw SQL (Prisma types don't have this field before db push)
  let outOfCityKmRate = 0;
  if (order.tariffId) {
    const rows = await prisma.$queryRaw<Array<{ r: string }>>`
      SELECT "outOfCityKmRate" AS r FROM tariffs WHERE id = ${order.tariffId} LIMIT 1
    `;
    outOfCityKmRate = Number(rows[0]?.r ?? 0);
  }
  if (!outOfCityKmRate && order.classId) {
    const rows = await prisma.$queryRaw<Array<{ r: string }>>`
      SELECT "outOfCityKmRate" AS r FROM tariffs
      WHERE "classId" = ${order.classId} AND "isActive" = true
      ORDER BY id ASC LIMIT 1
    `;
    outOfCityKmRate = Number(rows[0]?.r ?? 0);
  }

  // Create session via raw SQL so outOfCityKmRate is stored before Prisma client regen
  const sessionRows = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO order_trip_sessions
      ("orderId", "driverId", "tariffPerKm", "outOfCityKmRate", "baseFare", "startedAt", status,
       "preliminaryDistanceKm", "pointsReceived", "lastIsOutOfCity", "outOfCityKm", "outOfCitySeconds", "createdAt", "updatedAt")
    VALUES
      (${orderId}, ${auth.driverId}, ${Number(order.pricePerKm)}, ${outOfCityKmRate}, ${currentBaseFare},
       ${order.startedAt ?? new Date()}, 'active', 0, 0, false, 0, 0, NOW(), NOW())
    RETURNING id
  `;
  const sessionId = sessionRows[0]?.id;
  if (!sessionId) throw new Error("Failed to create trip session");
  const session = { id: sessionId, status: "active", pointsReceived: 0, lastSequenceNumber: null, startedAt: order.startedAt ?? new Date() };

  return NextResponse.json({
    data: {
      sessionId: session.id,
      status: session.status,
      pointsReceived: session.pointsReceived,
      lastSequenceNumber: session.lastSequenceNumber,
      startedAt: session.startedAt,
      outOfCityKmRate,
    },
  });
}
