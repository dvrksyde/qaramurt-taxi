/**
 * Shared logic for creating or retrieving an active trip session.
 * Used by both /trip/start and the status PATCH (in_progress) routes
 * so both return identical rates to the driver app.
 */

import { prisma } from "./prisma";

const BASE_FARE = 290;
const COMFORT_FARE = 390;
const CLASS_PRIORITY: Record<string, number> = { "Комфорт": 2, "Эконом": 1 };
const DEFAULT_OUT_RATES: Record<string, number> = { "Комфорт": 140, "Эконом": 120 };
const DEFAULT_CITY_RATES: Record<string, number> = { "Комфорт": 100, "Эконом": 80 };

export type TripSessionResult = {
  sessionId: number;
  effectiveBaseFare: number;
  effectiveCityRatePerKm: number;
  outOfCityKmRate: number;
};

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
    return (CLASS_PRIORITY[row.class_name] ?? 0) > (CLASS_PRIORITY[best] ?? 0) ? row.class_name : best;
  }, rows[0].class_name);
}

export async function getOrCreateTripSession(
  orderId: number,
  driverId: number,
): Promise<TripSessionResult | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, driverId },
    include: { class: true },
  });
  if (!order) return null;

  const orderClassName = order.class?.name ?? null;
  const effectiveClassName = orderClassName ?? (await getDriverBestClassName(driverId).catch(() => null));

  const currentBaseFare = effectiveClassName === "Комфорт" ? COMFORT_FARE : BASE_FARE;

  let baseFareWithWaiting = currentBaseFare;
  if (order.arrivedAt) {
    const startedAtTime = order.startedAt ? order.startedAt.getTime() : Date.now();
    const waitMins = Math.floor((startedAtTime - order.arrivedAt.getTime()) / 60000);
    if (waitMins > 3) baseFareWithWaiting += (waitMins - 3) * 20;
  }
  const orderOptions = Array.isArray(order.options) ? (order.options as Array<{ price?: number }>) : [];
  baseFareWithWaiting += orderOptions.reduce((s: number, o: any) => s + (Number(o.price) || 0), 0);

  let effectiveCityRatePerKm = Number(order.pricePerKm) || 80;
  if (!order.classId && effectiveClassName) {
    try {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`
        SELECT t."pricePerKm" AS r FROM tariffs t
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

  let outOfCityKmRate = 0;
  try {
    if (order.tariffId) {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`SELECT "outOfCityKmRate" AS r FROM tariffs WHERE id = ${order.tariffId} LIMIT 1`;
      outOfCityKmRate = Number(rows[0]?.r ?? 0);
    }
    if (!outOfCityKmRate && order.classId) {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`SELECT "outOfCityKmRate" AS r FROM tariffs WHERE "classId" = ${order.classId} AND "isActive" = true ORDER BY id ASC LIMIT 1`;
      outOfCityKmRate = Number(rows[0]?.r ?? 0);
    }
    if (!outOfCityKmRate && effectiveClassName) {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`SELECT t."outOfCityKmRate" AS r FROM tariffs t JOIN vehicle_classes vc ON vc.id = t."classId" WHERE vc.name = ${effectiveClassName} AND t."isActive" = true ORDER BY t.id ASC LIMIT 1`;
      outOfCityKmRate = Number(rows[0]?.r ?? 0);
    }
    if (!outOfCityKmRate && effectiveClassName) outOfCityKmRate = DEFAULT_OUT_RATES[effectiveClassName] ?? 0;
  } catch { /* column may not exist yet */ }

  // Return existing active session
  const existing = await prisma.orderTripSession.findFirst({
    where: { orderId, driverId, status: "active" },
    orderBy: { startedAt: "desc" },
  });
  if (existing) {
    let sessionRate = outOfCityKmRate;
    try {
      const rows = await prisma.$queryRaw<Array<{ r: string }>>`SELECT "outOfCityKmRate" AS r FROM order_trip_sessions WHERE id = ${existing.id} LIMIT 1`;
      sessionRate = Number(rows[0]?.r ?? outOfCityKmRate);
    } catch { /* ignore */ }
    return { sessionId: existing.id, effectiveBaseFare: baseFareWithWaiting, effectiveCityRatePerKm, outOfCityKmRate: sessionRate };
  }

  // Create new session
  try {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO order_trip_sessions
        ("orderId","driverId","tariffPerKm","outOfCityKmRate","baseFare","startedAt",status,
         "preliminaryDistanceKm","pointsReceived","lastIsOutOfCity","outOfCityKm","outOfCitySeconds","createdAt","updatedAt")
      VALUES (${orderId},${driverId},${effectiveCityRatePerKm},${outOfCityKmRate},${baseFareWithWaiting},
        ${order.startedAt ?? new Date()},'active',0,0,false,0,0,NOW(),NOW())
      RETURNING id
    `;
    const sessionId = rows[0]?.id ?? null;
    if (!sessionId) return null;
    return { sessionId, effectiveBaseFare: baseFareWithWaiting, effectiveCityRatePerKm, outOfCityKmRate };
  } catch {
    const session = await prisma.orderTripSession.create({
      data: { orderId, driverId, tariffPerKm: order.pricePerKm, baseFare: baseFareWithWaiting, startedAt: order.startedAt ?? new Date(), status: "active" },
    });
    return { sessionId: session.id, effectiveBaseFare: baseFareWithWaiting, effectiveCityRatePerKm, outOfCityKmRate };
  }
}
