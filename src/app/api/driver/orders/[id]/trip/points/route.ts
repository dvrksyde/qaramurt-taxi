export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { isDeliveryOrder } from "@/lib/orderPricing";
import { redis } from "@/lib/redis";

const CITY_ZONE_CACHE_KEY = "city_boundary_wkt";
const CITY_ZONE_CACHE_TTL = 300; // 5 min

async function getCityBoundaryWkt(): Promise<string | null> {
  try {
    const cached = await redis.get(CITY_ZONE_CACHE_KEY);
    if (cached) return cached;
  } catch { /* Redis might be unavailable */ }

  const rows = await prisma.$queryRaw<Array<{ polygon: string }>>`
    SELECT polygon FROM geozones
    WHERE type = 'city_boundary' AND "isActive" = true
    LIMIT 1
  `;
  const wkt = rows[0]?.polygon ?? null;

  if (wkt) {
    try { await redis.set(CITY_ZONE_CACHE_KEY, wkt, { EX: CITY_ZONE_CACHE_TTL }); } catch { }
  }
  return wkt;
}

type TripPointPayload = {
  sequenceNumber: number;
  lat: number;
  lng: number;
  capturedAt: string;
  accuracyM?: number | null;
  speedKmh?: number | null;
  headingDeg?: number | null;
};

function normalizePoints(points: unknown[]): TripPointPayload[] {
  const normalized = points
    .map((point) => point as Partial<TripPointPayload>)
    .filter((point) =>
      typeof point.sequenceNumber === "number" &&
      Number.isFinite(point.sequenceNumber) &&
      typeof point.lat === "number" &&
      Number.isFinite(point.lat) &&
      typeof point.lng === "number" &&
      Number.isFinite(point.lng) &&
      typeof point.capturedAt === "string" &&
      !Number.isNaN(new Date(point.capturedAt).getTime())
    )
    .map((point) => ({
      sequenceNumber: point.sequenceNumber as number,
      lat: point.lat as number,
      lng: point.lng as number,
      capturedAt: point.capturedAt as string,
      accuracyM: typeof point.accuracyM === "number" && Number.isFinite(point.accuracyM) ? point.accuracyM : null,
      speedKmh: typeof point.speedKmh === "number" && Number.isFinite(point.speedKmh) ? point.speedKmh : null,
      headingDeg: typeof point.headingDeg === "number" && Number.isFinite(point.headingDeg) ? point.headingDeg : null,
    }))
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  return normalized;
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

  const body = await req.json().catch(() => null);
  const sessionId = typeof body?.sessionId === "number" ? body.sessionId : null;
  const rawPoints = Array.isArray(body?.points) ? body.points : [];
  const points = normalizePoints(rawPoints);

  if (points.length === 0) {
    return NextResponse.json({ error: "Нет валидных GPS-точек для сохранения" }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, driverId: auth.driverId },
    include: { service: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  if (isDeliveryOrder(order)) {
    return NextResponse.json(
      { error: "Для доставки GPS-точки поездки не используются" },
      { status: 400 }
    );
  }

  // Raw query to access new fields (lastIsOutOfCity, outOfCityKmRate) before Prisma regen
  type RawSession = {
    id: number;
    order_id: number;
    driver_id: number | null;
    points_received: number;
    last_sequence_number: number | null;
    last_is_out_of_city: boolean;
    out_of_city_km_rate: string;
  };

  const whereClause = sessionId
    ? `AND ots.id = ${sessionId}`
    : "";

  const sessions = await prisma.$queryRawUnsafe<RawSession[]>(`
    SELECT ots.id,
           ots."orderId"           AS order_id,
           ots."driverId"          AS driver_id,
           ots."pointsReceived"    AS points_received,
           ots."lastSequenceNumber" AS last_sequence_number,
           ots."lastIsOutOfCity"   AS last_is_out_of_city,
           ots."outOfCityKmRate"   AS out_of_city_km_rate
    FROM order_trip_sessions ots
    WHERE ots."orderId" = $1
      AND ots."driverId" = $2
      AND ots.status = 'active'
      ${whereClause}
    ORDER BY ots."startedAt" DESC
    LIMIT 1
  `, orderId, auth.driverId);

  const session = sessions[0] ?? null;

  if (!session) {
    return NextResponse.json(
      { error: "Активная сессия поездки не найдена. Сначала начните поездку." },
      { status: 409 }
    );
  }

  const createResult = await prisma.orderTripPoint.createMany({
    data: points.map((point) => ({
      tripSessionId: session.id,
      sequenceNumber: point.sequenceNumber,
      lat: point.lat,
      lng: point.lng,
      accuracyM: point.accuracyM,
      speedKmh: point.speedKmh,
      headingDeg: point.headingDeg,
      capturedAt: new Date(point.capturedAt),
    })),
    skipDuplicates: true,
  });

  const lastPoint = points[points.length - 1];
  const latestSeq = lastPoint?.sequenceNumber ?? session.last_sequence_number ?? null;
  const latestCapturedAt = new Date(lastPoint?.capturedAt ?? Date.now());
  const prevSeq = session.last_sequence_number ?? 0;
  const newSeq = latestSeq === null ? prevSeq : Math.max(prevSeq, latestSeq);

  // ── Zone detection (city boundary check) ──────────────────────────────────
  let newIsOutOfCity = session.last_is_out_of_city;
  try {
    const cityWkt = await getCityBoundaryWkt();
    if (cityWkt && createResult.count > 0) {
      const seqNums = points.map((p) => p.sequenceNumber);

      // Batch-update isOutOfCity for newly inserted points using PostGIS
      await prisma.$executeRaw`
        UPDATE order_trip_points otp
        SET "isOutOfCity" = NOT ST_Contains(
          ST_GeomFromText(${cityWkt}, 4326),
          ST_SetSRID(ST_MakePoint(CAST(otp.lng AS float8), CAST(otp.lat AS float8)), 4326)
        )
        WHERE otp."tripSessionId" = ${session.id}
          AND otp."sequenceNumber" = ANY(${seqNums}::integer[])
      `;

      // Get last point's zone via raw SQL (Prisma type doesn't have isOutOfCity yet)
      const lastPts = await prisma.$queryRaw<Array<{ is_out_of_city: boolean }>>`
        SELECT "isOutOfCity" AS is_out_of_city
        FROM order_trip_points
        WHERE "tripSessionId" = ${session.id}
        ORDER BY "sequenceNumber" DESC
        LIMIT 1
      `;
      newIsOutOfCity = lastPts[0]?.is_out_of_city ?? session.last_is_out_of_city;
    }
  } catch (zoneErr) {
    console.error("[trip/points] Zone check error:", zoneErr);
  }

  // Update session — use raw SQL for new fields
  await prisma.$executeRaw`
    UPDATE order_trip_sessions
    SET "pointsReceived"     = "pointsReceived" + ${createResult.count},
        "lastSequenceNumber" = ${newSeq},
        "lastPointAt"        = ${latestCapturedAt},
        "lastIsOutOfCity"    = ${newIsOutOfCity}
    WHERE id = ${session.id}
  `;

  // Emit zone_change if driver crossed the city boundary
  if (newIsOutOfCity !== session.last_is_out_of_city) {
    const io = (global as Record<string, unknown>).socketIO as any;
    if (io) {
      const outOfCityRate = Number(session.out_of_city_km_rate ?? 0);
      io.to(`driver:${auth.driverId}`).emit("zone_change", {
        isOutOfCity: newIsOutOfCity,
        outOfCityRatePerKm: outOfCityRate,
        message: newIsOutOfCity
          ? `Выехали за город — ${outOfCityRate} ₸/км + 25 ₸/мин`
          : "Вернулись в город — городской тариф",
      });
    }
  }

  return NextResponse.json({
    data: {
      sessionId: session.id,
      inserted: createResult.count,
      received: points.length,
      pointsReceived: session.points_received + createResult.count,
      lastSequenceNumber: newSeq,
      lastPointAt: latestCapturedAt,
    },
  });
}
