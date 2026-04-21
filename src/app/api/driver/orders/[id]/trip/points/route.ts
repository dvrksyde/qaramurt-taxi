export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { isDeliveryOrder } from "@/lib/orderPricing";

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

  const session = await prisma.orderTripSession.findFirst({
    where: {
      orderId,
      driverId: auth.driverId,
      status: "active",
      ...(sessionId ? { id: sessionId } : {}),
    },
    orderBy: { startedAt: "desc" },
  });

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

  const latestSequenceNumber = points[points.length - 1]?.sequenceNumber ?? session.lastSequenceNumber ?? null;
  const latestCapturedAt = new Date(points[points.length - 1]?.capturedAt ?? Date.now());

  const updatedSession = await prisma.orderTripSession.update({
    where: { id: session.id },
    data: {
      pointsReceived: { increment: createResult.count },
      lastSequenceNumber:
        latestSequenceNumber === null
          ? session.lastSequenceNumber
          : Math.max(session.lastSequenceNumber ?? latestSequenceNumber, latestSequenceNumber),
      lastPointAt: latestCapturedAt,
    },
  });

  return NextResponse.json({
    data: {
      sessionId: updatedSession.id,
      inserted: createResult.count,
      received: points.length,
      pointsReceived: updatedSession.pointsReceived,
      lastSequenceNumber: updatedSession.lastSequenceNumber,
      lastPointAt: updatedSession.lastPointAt,
    },
  });
}
