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
    where: { orderId, driverId: auth.driverId, status: "active" },
    orderBy: { startedAt: "desc" },
  });

  if (existingSession) {
    // Try to read outOfCityKmRate from session (column may not exist yet before db:push)
    let outOfCityKmRate = 0;
    try {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`
        SELECT "outOfCityKmRate" AS r FROM order_trip_sessions WHERE id = ${existingSession.id} LIMIT 1
      `;
      outOfCityKmRate = Number(rows[0]?.r ?? 0);
    } catch { /* column doesn't exist yet — that's fine */ }

    return NextResponse.json({
      data: {
        sessionId: existingSession.id,
        status: existingSession.status,
        pointsReceived: existingSession.pointsReceived,
        lastSequenceNumber: existingSession.lastSequenceNumber,
        startedAt: existingSession.startedAt,
        outOfCityKmRate,
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

  // Try to get outOfCityKmRate from tariff (column might not exist before db:push)
  let outOfCityKmRate = 0;
  try {
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
  } catch { /* column doesn't exist yet — outOfCityKmRate stays 0 */ }

  // Try to create session with new columns; fall back to basic create if schema not updated yet
  let sessionId: number | null = null;

  try {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO order_trip_sessions
        ("orderId", "driverId", "tariffPerKm", "outOfCityKmRate", "baseFare", "startedAt", status,
         "preliminaryDistanceKm", "pointsReceived", "lastIsOutOfCity", "outOfCityKm", "outOfCitySeconds",
         "createdAt", "updatedAt")
      VALUES
        (${orderId}, ${auth.driverId}, ${Number(order.pricePerKm)}, ${outOfCityKmRate}, ${currentBaseFare},
         ${order.startedAt ?? new Date()}, 'active', 0, 0, false, 0, 0, NOW(), NOW())
      RETURNING id
    `;
    sessionId = rows[0]?.id ?? null;
  } catch {
    // New columns don't exist yet (db:push not run) — fall back to Prisma ORM create
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
    sessionId = session.id;
  }

  if (!sessionId) {
    return NextResponse.json({ error: "Не удалось создать сессию поездки" }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      sessionId,
      status: "active",
      pointsReceived: 0,
      lastSequenceNumber: null,
      startedAt: order.startedAt ?? new Date(),
      outOfCityKmRate,
    },
  });
}
