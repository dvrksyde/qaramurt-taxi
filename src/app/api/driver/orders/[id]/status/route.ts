export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { reverseGeocode } from "@/lib/geocoder";
import { isDeliveryOrder } from "@/lib/orderPricing";
import { calculateSessionDistance, completeSession } from "@/lib/tripDistance";
import { getOrCreateTripSession } from "@/lib/tripSession";

const BASE_FARE = 290;

function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { id } = await params;
  const orderId = parseInt(id, 10);

  const body = await req.json();
  const { status, lat, lng } = body;

  // Fixed-price orders send distanceKm + finalPrice directly.
  // Non-fixed orders send clientDistanceKm + clientFinalPrice as a BACKUP
  // (server will prefer GPS calculation; falls back to these if < 2 points).
  const clientDistanceKm: number | undefined =
    body.clientDistanceKm ?? body.distanceKm;
  const clientFinalPrice: number | undefined =
    body.clientFinalPrice ?? body.finalPrice;
  // clientOutOfCityKm / clientOutOfCitySeconds: tracked locally by the app.
  // Used as fallback for breakdown when server-side zone detection lagged or failed.
  const clientOutOfCityKm: number | undefined = body.clientOutOfCityKm;
  const clientOutOfCitySeconds: number | undefined = body.clientOutOfCitySeconds;

  const validStatuses = ["arrived", "in_progress", "completed", "canceled"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, driverId: auth.driverId },
    include: { service: true, class: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  // Guard against re-processing terminal states — prevents double commission
  if (order.status === "completed" || order.status === "canceled") {
    return NextResponse.json({ error: "Заказ уже завершён" }, { status: 409 });
  }

  // Validate status transition.
  // NOTE: arrived → completed is allowed — handles offline trips where the
  // driver started the trip without network (in_progress PATCH never reached server).
  const allowedTransitions: Record<string, string[]> = {
    assigned:    ["arrived", "canceled"],
    arrived:     ["in_progress", "completed", "canceled"],
    in_progress: ["completed", "canceled"],
  };
  if (!allowedTransitions[order.status]?.includes(status)) {
    return NextResponse.json(
      { error: `Переход ${order.status} → ${status} недопустим` },
      { status: 422 }
    );
  }

  const updateData: Record<string, unknown> = { status };
  const fixedPriceOrder = isDeliveryOrder(order);
  const currentBaseFare = order.class?.name === "Комфорт" ? 390 : BASE_FARE;

  if (status === "arrived") {
    updateData.arrivedAt = new Date();
  } else if (status === "in_progress") {
    updateData.startedAt = new Date();

    if (order.arrivedAt) {
      const waitMs = (updateData.startedAt as Date).getTime() - order.arrivedAt.getTime();
      const waitMins = Math.floor(waitMs / 60000);
      if (waitMins > 3) {
        const waitFee = (waitMins - 3) * 20;
        if (fixedPriceOrder) {
          updateData.estimatedPrice = Number(order.estimatedPrice || 0) + waitFee;
        }
      }
    }

    // Create/get trip session immediately and embed rates in response —
    // same as curbside does, so the app counter starts with correct rates from second 1.
    if (!fixedPriceOrder) {
      try {
        const session = await getOrCreateTripSession(orderId, auth.driverId);
        if (session) {
          (updateData as any)._sessionId       = session.sessionId;
          (updateData as any)._baseFare         = session.effectiveBaseFare;
          (updateData as any)._cityRate         = session.effectiveCityRatePerKm;
          (updateData as any)._outOfCityRate    = session.outOfCityKmRate;
        }
      } catch { /* non-critical — app falls back to async getTripRates */ }
    }
  } else if (status === "completed") {
    // Driver completed trip while offline (arrived→completed skip):
    // in_progress PATCH never reached server — auto-stamp startedAt.
    if (order.status === "arrived") {
      updateData.startedAt = new Date();
    }
    updateData.completedAt = new Date();


    // Save dropoff coordinates immediately (without waiting for geocoding)
    if (typeof lat === "number" && typeof lng === "number") {
      updateData.dropoffPoint = `POINT(${lng} ${lat})`;
      // reverseGeocode runs in the background — does NOT block the response
      void (async () => {
        try {
          const address = await reverseGeocode(lat, lng);
          if (address) {
            await prisma.order.update({
              where: { id: orderId },
              data: { dropoffAddress: address },
            });
          }
        } catch {
          // Non-critical — ignore geocoding failures
        }
      })();
    }

    if (fixedPriceOrder) {
      // Fixed-price orders: use pre-set estimatedPrice from operator
      if (order.distanceKm !== null && order.distanceKm !== undefined) {
        updateData.distanceKm = order.distanceKm;
      } else if (clientDistanceKm !== undefined) {
        updateData.distanceKm = clientDistanceKm;
      }
      const fixedPrice =
        order.estimatedPrice !== null && order.estimatedPrice !== undefined
          ? Number(order.estimatedPrice)
          : clientFinalPrice;
      if (fixedPrice !== undefined) {
        updateData.finalPrice = fixedPrice;
      }
    } else {
      // ── CLIENT-AUTHORITATIVE COMPLETION ─────────────────────────────────────
      // Find the active trip session to persist client-calculated values
      const activeSession = await prisma.orderTripSession.findFirst({
        where: {
          orderId,
          driverId: auth.driverId,
          status: "active",
        },
        orderBy: { startedAt: "desc" },
      });

      if (activeSession) {
        // Session rates (set at trip/start)
        const sessionBaseFare = Number(activeSession.baseFare)    || currentBaseFare;
        const sessionCityRate = Number(activeSession.tariffPerKm) || Number(order.pricePerKm) || 80;
        const midTripWaitFee  = Number(order.waitingFee || 0);

        let sessionOutOfCityRate = 0;
        try {
          const rr = await prisma.$queryRaw<Array<{ r: string }>>`
            SELECT "outOfCityKmRate" AS r FROM order_trip_sessions WHERE id = ${activeSession.id} LIMIT 1
          `;
          sessionOutOfCityRate = Number(rr[0]?.r ?? 0);
        } catch { /* column not yet created */ }

        // ── PARALLEL CLIENT + SERVER CALCULATION ─────────────────────────────
        // Client: Kalman odometer + GraphHopper map matching (real-time, shown to driver)
        // Server: GPS points from DB via haversine + OSRM (fraud detection)
        //
        // Final price = client price (if valid and server agrees within 20%)
        // Fraud flag  = if client distance > server distance by more than 20%
        const clientPriceIsValid = clientFinalPrice !== undefined
          && clientFinalPrice >= sessionBaseFare;

        let finalDistKm = clientDistanceKm ?? 0;
        let finalPrice  = clientPriceIsValid
          ? clientFinalPrice!
          : (sessionBaseFare + midTripWaitFee);

        let bOutCityKm  = clientOutOfCityKm  ?? 0;
        let bOutCitySec = clientOutOfCitySeconds ?? 0;
        let isSuspicious = false;

        try {
          const serverCalc = await calculateSessionDistance(activeSession.id);

          if (serverCalc.distanceKm > 0) {
            const serverDistKm = serverCalc.distanceKm;
            const serverPrice  = Math.max(serverCalc.finalPrice, sessionBaseFare) + midTripWaitFee;

            // Fraud check: client claims significantly more distance than GPS trace shows.
            // Requires enough server-side points to be meaningful — offline trips may
            // have partial GPS uploads (weak network), which would cause false positives.
            // Rule: need at least 1 point per 10 seconds of trip (rough coverage check).
            const clientDist = clientDistanceKm ?? 0;
            const tripSec = order.startedAt
              ? (Date.now() - new Date(order.startedAt).getTime()) / 1000
              : 0;
            const minPointsNeeded = Math.max(10, Math.floor(tripSec / 10));
            const hasEnoughPoints = serverCalc.pointsUsed >= minPointsNeeded;

            if (hasEnoughPoints && clientDist > 0 && serverDistKm > 0) {
              const ratio = clientDist / serverDistKm;
              if (ratio > 1.20) {
                isSuspicious = true;
                console.warn(`[fraud] order=${orderId} client=${clientDist}km server=${serverDistKm}km ratio=${ratio.toFixed(2)} points=${serverCalc.pointsUsed}/${minPointsNeeded}`);
              }
            } else if (!hasEnoughPoints) {
              console.log(`[trip/complete] Skipping fraud check — insufficient GPS points: ${serverCalc.pointsUsed}/${minPointsNeeded}`);
            }

            // Distance: take max (client has real-time Kalman, server may have gaps from weak network)
            finalDistKm = Math.max(finalDistKm, serverDistKm);

            // Price: if client is suspicious, use server price; otherwise use max
            if (isSuspicious) {
              finalPrice = serverPrice;
            } else {
              finalPrice = clientPriceIsValid
                ? Math.max(clientFinalPrice!, serverPrice)
                : serverPrice;
            }

            // Zone breakdown: prefer server data (PostGIS is authoritative)
            bOutCityKm  = serverCalc.outOfCityKm  > 0 ? serverCalc.outOfCityKm  : bOutCityKm;
            bOutCitySec = serverCalc.outOfCitySeconds > 0 ? serverCalc.outOfCitySeconds : bOutCitySec;
          }

          console.log(`[trip/complete] client=${clientDistanceKm}km/${clientFinalPrice}₸ server=${serverCalc.distanceKm}km/${serverCalc.finalPrice}₸ → final=${finalDistKm}km/${finalPrice}₸ suspicious=${isSuspicious}`);
        } catch (err) {
          // Server calc failed (no GPS points or OSRM error) — use client values
          console.warn("[trip/complete] Server calc failed, using client values:", err);
        }

        const bCityKm = Math.max(0, finalDistKm - bOutCityKm);

        await completeSession(activeSession.id, finalDistKm, finalPrice, bOutCityKm, bOutCitySec);
        updateData.distanceKm = finalDistKm;
        updateData.finalPrice  = finalPrice;
        if (isSuspicious) (updateData as any).isSuspicious = true;

        (updateData as any)._breakdown = {
          baseFare:         sessionBaseFare,
          cityKm:           bCityKm,
          cityRatePerKm:    sessionCityRate,
          outOfCityKm:      bOutCityKm,
          outOfCityKmRate:  sessionOutOfCityRate || sessionCityRate,
          outOfCitySeconds: bOutCitySec,
        };
      } else {
        // No GPS session at all — trust clientFinalPrice fully
        const noSessionRate = Number(order.pricePerKm) || 80;
        if (clientFinalPrice !== undefined && clientFinalPrice >= currentBaseFare) {
          // Client price is valid and above minimum — use it directly
          updateData.finalPrice  = clientFinalPrice;
          updateData.distanceKm = clientDistanceKm ?? 0;
        } else if (clientDistanceKm !== undefined) {
          // Client price missing/invalid — compute from distance
          const computed = roundTo5(currentBaseFare + Number(clientDistanceKm) * noSessionRate);
          updateData.distanceKm = clientDistanceKm;
          updateData.finalPrice  = Math.max(computed, currentBaseFare);
        } else {
          updateData.finalPrice = currentBaseFare;
        }
        // Always provide breakdown so the modal isn't empty
        // Use client-tracked out-of-city km split for accurate breakdown
        const noSessCityKm = Math.max(0, (clientDistanceKm ?? 0) - (clientOutOfCityKm ?? 0));
        const noSessOutKm  = clientOutOfCityKm ?? 0;
        (updateData as any)._breakdown = {
          baseFare:         currentBaseFare,
          cityKm:           noSessCityKm,
          cityRatePerKm:    noSessionRate,
          outOfCityKm:      noSessOutKm,
          outOfCityKmRate:  noSessionRate,
          outOfCitySeconds: 0,
        };
      }
      // ────────────────────────────────────────────────────────────────────────
    }
  } else if (status === "canceled") {
    updateData.canceledAt = new Date();

    // Also cancel any active trip session
    await prisma.orderTripSession.updateMany({
      where: { orderId, driverId: auth.driverId, status: "active" },
      data: { status: "canceled", completedAt: new Date() },
    });
  }

  // ── Extract response-only fields BEFORE Prisma transaction ─────────────────
  // These fields are NOT columns in the Order model — they're returned to the
  // driver app in the response body only. Passing them to Prisma throws
  // PrismaClientValidationError and fails the entire transaction silently.
  const tripBreakdownForResponse = (updateData as any)._breakdown   ?? null;
  const sessionIdForResponse     = (updateData as any)._sessionId   ?? undefined;
  const baseFareForResponse      = (updateData as any)._baseFare    ?? undefined;
  const cityRateForResponse      = (updateData as any)._cityRate    ?? undefined;
  const outOfCityRateForResponse = (updateData as any)._outOfCityRate ?? undefined;

  delete (updateData as any)._breakdown;
  delete (updateData as any)._sessionId;
  delete (updateData as any)._baseFare;
  delete (updateData as any)._cityRate;
  delete (updateData as any)._outOfCityRate;
  // ──────────────────────────────────────────────────────────────────────────

  await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: updateData,
    });

    let operatorId = updatedOrder.operatorId;
    if (!operatorId) {
      const defaultOp = await tx.operator.findFirst({ orderBy: { id: 'asc' } });
      operatorId = defaultOp?.id ?? 1;
    }

    if (status === "completed" && updatedOrder.finalPrice) {
      const dTG = await tx.driver.findUnique({
        where: { id: auth.driverId },
        include: { tariffGroup: true }
      });

      // Commission: always read from driver's tariff group (no hardcoded rates).
      // Fallback 13 = "Стандарт" rate — only used if driver has no tariff group assigned.
      const commPercent = Number(dTG?.tariffGroup?.value || 13);
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

  // Read back the final values to return to the driver app
  const finalOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: { distanceKm: true, finalPrice: true, waitingFee: true, waitingAccumulatedSeconds: true },
  });

  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    io.to("monitor").emit("order_status_change", {
      orderId,
      status,
      driverId: auth.driverId,
      distanceKm: finalOrder?.distanceKm,
      finalPrice: finalOrder?.finalPrice,
      waitingFee: finalOrder?.waitingFee,
    });

    if (status === "completed") {
      io.to("monitor").emit("driver_ratings_updated", { driverId: auth.driverId, orderId });
      io.to("drivers").emit("driver_ratings_updated", { driverId: auth.driverId, orderId });
      io.to(`driver:${auth.driverId}`).emit("driver_ratings_updated", { driverId: auth.driverId, orderId });
    }
  }

  return NextResponse.json({
    data: {
      orderId,
      status,
      distanceKm: finalOrder?.distanceKm ?? null,
      finalPrice: finalOrder?.finalPrice ?? null,
      waitingFee: finalOrder?.waitingFee ?? 0,
      waitingAccumulatedSeconds: finalOrder?.waitingAccumulatedSeconds ?? 0,
      breakdown: status === "completed" ? (tripBreakdownForResponse ?? null) : undefined,
      // Session + rates for in_progress — app sets them synchronously (no async getTripRates needed)
      _sessionId:    sessionIdForResponse,
      _baseFare:     baseFareForResponse,
      _cityRate:     cityRateForResponse,
      _outOfCityRate: outOfCityRateForResponse,
    },
  });
}
