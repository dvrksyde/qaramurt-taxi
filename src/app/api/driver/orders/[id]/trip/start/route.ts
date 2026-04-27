export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { isDeliveryOrder } from "@/lib/orderPricing";

const BASE_FARE = 290;
const COMFORT_FARE = 390;

const CLASS_PRIORITY: Record<string, number> = { "Комфорт": 2, "Эконом": 1 };
const DEFAULT_OUT_RATES: Record<string, number> = { "Комфорт": 140, "Эконом": 120 };
const DEFAULT_CITY_RATES: Record<string, number> = { "Комфорт": 100, "Эконом": 80 };

/** Returns the best class name for a driver based on their vehicle classes. */
async function getDriverBestClassName(driverId: number): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ class_name: string }>>`
    SELECT vc.name AS class_name
    FROM drivers d
    JOIN vehicles v ON v."driverId" = d.id AND v."isActive" = true
    JOIN vehicle_class_links vcl ON vcl."vehicleId" = v.id
    JOIN vehicle_classes vc ON vc.id = vcl."classId"
    WHERE d.id = ${driverId}
  `;
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => {
    const bp = CLASS_PRIORITY[best] ?? 0;
    const rp = CLASS_PRIORITY[row.class_name] ?? 0;
    return rp > bp ? row.class_name : best;
  }, rows[0].class_name);
}

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

  // ── Determine effective class (order class → driver's best vehicle class) ──
  const orderClassName = order.class?.name ?? null;
  const effectiveClassName = orderClassName
    ?? (await getDriverBestClassName(auth.driverId).catch(() => null));

  // Base fare by effective class
  const currentBaseFare = effectiveClassName === "Комфорт" ? COMFORT_FARE : BASE_FARE;

  // Apply waiting fee (arrived → in_progress)
  let baseFareWithWaiting = currentBaseFare;
  if (order.arrivedAt) {
    const startedAtTime = order.startedAt ? order.startedAt.getTime() : Date.now();
    const waitMs = startedAtTime - order.arrivedAt.getTime();
    const waitMins = Math.floor(waitMs / 60000);
    if (waitMins > 3) {
      baseFareWithWaiting += (waitMins - 3) * 20;
    }
  }

  // Add order options (luggage, conditioner, etc.) to baseFare so server calc matches client.
  // Options are stored as [{name, price, ...}] objects — same formula as client extrasTotal.
  const orderOptions = Array.isArray(order.options) ? (order.options as Array<{ price?: number }>) : [];
  const optionsTotal = orderOptions.reduce((sum: number, opt: any) => sum + (Number(opt.price) || 0), 0);
  baseFareWithWaiting += optionsTotal;

  // ── Effective city rate per km ────────────────────────────────────────────
  // For orders with a specific class: use order.pricePerKm (set by dispatcher from tariff)
  // For "Любой" orders: derive from driver's class
  let effectiveCityRatePerKm = Number(order.pricePerKm) || 80;
  if (!order.classId && effectiveClassName) {
    // "Любой" order — override with driver's class rate
    try {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`
        SELECT t."pricePerKm" AS r
        FROM tariffs t
        JOIN vehicle_classes vc ON vc.id = t."classId"
        WHERE vc.name = ${effectiveClassName} AND t."isActive" = true
        ORDER BY t.id ASC LIMIT 1
      `;
      effectiveCityRatePerKm = rows[0]?.r
        ? Number(rows[0].r)
        : (DEFAULT_CITY_RATES[effectiveClassName] ?? effectiveCityRatePerKm);
    } catch {
      effectiveCityRatePerKm = DEFAULT_CITY_RATES[effectiveClassName] ?? effectiveCityRatePerKm;
    }
  }

  // ── outOfCityKmRate ───────────────────────────────────────────────────────
  let outOfCityKmRate = 0;
  try {
    // 1. From order's selected tariff
    if (order.tariffId) {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`
        SELECT "outOfCityKmRate" AS r FROM tariffs WHERE id = ${order.tariffId} LIMIT 1
      `;
      outOfCityKmRate = Number(rows[0]?.r ?? 0);
    }
    // 2. From order's class tariff
    if (!outOfCityKmRate && order.classId) {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`
        SELECT "outOfCityKmRate" AS r FROM tariffs
        WHERE "classId" = ${order.classId} AND "isActive" = true
        ORDER BY id ASC LIMIT 1
      `;
      outOfCityKmRate = Number(rows[0]?.r ?? 0);
    }
    // 3. From driver's vehicle class tariff
    if (!outOfCityKmRate && effectiveClassName) {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`
        SELECT t."outOfCityKmRate" AS r
        FROM tariffs t
        JOIN vehicle_classes vc ON vc.id = t."classId"
        WHERE vc.name = ${effectiveClassName} AND t."isActive" = true
        ORDER BY t.id ASC LIMIT 1
      `;
      outOfCityKmRate = Number(rows[0]?.r ?? 0);
    }
    // 4. Hardcoded defaults (Эконом=120, Комфорт=140)
    if (!outOfCityKmRate && effectiveClassName) {
      outOfCityKmRate = DEFAULT_OUT_RATES[effectiveClassName] ?? 0;
    }
  } catch { /* column doesn't exist yet */ }

  // ── Return existing session if one is active ──────────────────────────────
  const existingSession = await prisma.orderTripSession.findFirst({
    where: { orderId, driverId: auth.driverId, status: "active" },
    orderBy: { startedAt: "desc" },
  });

  if (existingSession) {
    let sessionOutOfCityRate = outOfCityKmRate;
    try {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`
        SELECT "outOfCityKmRate" AS r FROM order_trip_sessions WHERE id = ${existingSession.id} LIMIT 1
      `;
      sessionOutOfCityRate = Number(rows[0]?.r ?? outOfCityKmRate);
    } catch { /* column doesn't exist yet */ }

    return NextResponse.json({
      data: {
        sessionId: existingSession.id,
        status: existingSession.status,
        pointsReceived: existingSession.pointsReceived,
        lastSequenceNumber: existingSession.lastSequenceNumber,
        startedAt: existingSession.startedAt,
        outOfCityKmRate: sessionOutOfCityRate,
        effectiveBaseFare: baseFareWithWaiting,
        effectiveCityRatePerKm,
      },
    });
  }

  // ── Create new trip session ───────────────────────────────────────────────
  let sessionId: number | null = null;

  try {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO order_trip_sessions
        ("orderId", "driverId", "tariffPerKm", "outOfCityKmRate", "baseFare", "startedAt", status,
         "preliminaryDistanceKm", "pointsReceived", "lastIsOutOfCity", "outOfCityKm", "outOfCitySeconds",
         "createdAt", "updatedAt")
      VALUES
        (${orderId}, ${auth.driverId}, ${effectiveCityRatePerKm}, ${outOfCityKmRate}, ${baseFareWithWaiting},
         ${order.startedAt ?? new Date()}, 'active', 0, 0, false, 0, 0, NOW(), NOW())
      RETURNING id
    `;
    sessionId = rows[0]?.id ?? null;
  } catch {
    const session = await prisma.orderTripSession.create({
      data: {
        orderId,
        driverId: auth.driverId,
        tariffPerKm: order.pricePerKm,
        baseFare: baseFareWithWaiting,
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
      effectiveBaseFare: baseFareWithWaiting,
      effectiveCityRatePerKm,
    },
  });
}
