export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { reverseGeocode } from "@/lib/geocoder";
import { isDeliveryOrder } from "@/lib/orderPricing";
import { calculateSessionDistance, completeSession } from "@/lib/tripDistance";

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
  // clientOutOfCityKm: tracked locally by the app (outOfCityAccumulatedKm in store)
  // Used for accurate breakdown when GPS points are missing
  const clientOutOfCityKm: number | undefined = body.clientOutOfCityKm;

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
      // ── SERVER-SIDE DISTANCE CALCULATION ────────────────────────────────────
      // Find the active trip session for this order to compute real distance
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
        const sessionBaseFare  = Number(activeSession.baseFare)    || currentBaseFare;
        const sessionCityRate  = Number(activeSession.tariffPerKm) || Number(order.pricePerKm) || 80;
        const midTripWaitFee   = Number(order.waitingFee || 0);

        // Read out-of-city rate (added via raw SQL column)
        let sessionOutOfCityRate = 0;
        try {
          const rr = await prisma.$queryRaw<Array<{ r: string }>>`
            SELECT "outOfCityKmRate" AS r FROM order_trip_sessions WHERE id = ${activeSession.id} LIMIT 1
          `;
          sessionOutOfCityRate = Number(rr[0]?.r ?? 0);
        } catch { /* column not yet created */ }

        // ── VARIANT B: Client price is the authoritative source ──────────────
        // The driver app meter accumulates price locally with correct zone-aware
        // rates (city vs out-of-city). Server GPS points may be incomplete due
        // to weak network in rural areas, so we trust the client meter.
        //
        // Security: clientFinalPrice must be >= sessionBaseFare (minimum floor).
        // If client sends a suspiciously low price → fall back to server calc.
        //
        // Server GPS calc still runs for:
        //   • distanceKm  — server-side segment filtering is more accurate
        //   • breakdown   — city/out-of-city split for the summary modal
        //   • audit trail — GPS points stored in DB regardless
        // ────────────────────────────────────────────────────────────────────
        const clientPriceIsValid = clientFinalPrice !== undefined
          && clientFinalPrice >= sessionBaseFare;

        let tripBreakdown: {
          baseFare: number; cityKm: number; cityRatePerKm: number;
          outOfCityKm: number; outOfCityKmRate: number; outOfCitySeconds: number;
        } | null = null;

        try {
          const calc = await calculateSessionDistance(activeSession.id);

          // Distance: take the LARGER of server GPS and client distance.
          // Server GPS may be incomplete (fire-and-forget upload → partial points).
          // Client accumulates in real-time from every GPS update → more complete.
          // Math.max ensures the DB never shows less than what the driver actually drove.
          const serverDistKm = calc.distanceKm > 0 ? calc.distanceKm : 0;
          const finalDistKm  = Math.max(serverDistKm, clientDistanceKm ?? 0);
          console.log(`[trip/complete] dist: server=${serverDistKm} client=${clientDistanceKm} → using ${finalDistKm}`);

          // Price: VARIANT B
          //   clientFinalPrice (if valid) → always wins
          //   server calc                → used only when client price is missing/invalid
          //   Note: clientFinalPrice already includes waitingFee + outOfCityTimeFee
          //         so we do NOT add midTripWaitFee again when using client price.
          let finalPrice: number;
          if (clientPriceIsValid) {
            finalPrice = clientFinalPrice!;
            console.log(`[trip/complete] VariantB: using clientFinalPrice=${finalPrice} (server=${calc.finalPrice})`);
          } else {
            // Client price absent or below minimum → use server calc + waiting fee
            finalPrice = Math.max(calc.finalPrice, sessionBaseFare) + midTripWaitFee;
            console.log(`[trip/complete] VariantB: client price invalid (${clientFinalPrice}), using serverPrice=${finalPrice}`);
          }

          await completeSession(activeSession.id, finalDistKm, finalPrice, calc.outOfCityKm, calc.outOfCitySeconds);
          updateData.distanceKm = finalDistKm;
          updateData.finalPrice  = finalPrice;

          // Breakdown: derive out-of-city km from server GPS if available, else client.
          // City km = finalDistKm − out-of-city km (so breakdown always sums to finalDistKm).
          const bOutCityKm = calc.distanceKm > 0 ? calc.outOfCityKm : (clientOutOfCityKm ?? 0);
          const bCityKm    = Math.max(0, finalDistKm - bOutCityKm);
          tripBreakdown = {
            baseFare:          sessionBaseFare,
            cityKm:            bCityKm,
            cityRatePerKm:     sessionCityRate,
            outOfCityKm:       bOutCityKm,
            outOfCityKmRate:   sessionOutOfCityRate || sessionCityRate,
            outOfCitySeconds:  calc.outOfCitySeconds,
          };
        } catch (err) {
          // Server calc crashed entirely — client price is our only option
          console.error("[trip/complete] Server calc failed:", err);
          const finalPrice = clientPriceIsValid
            ? clientFinalPrice!
            : (sessionBaseFare + midTripWaitFee);
          updateData.distanceKm = clientDistanceKm ?? 0;
          updateData.finalPrice  = finalPrice;
          tripBreakdown = {
            baseFare:         sessionBaseFare,
            cityKm:           clientDistanceKm ?? 0,
            cityRatePerKm:    sessionCityRate,
            outOfCityKm:      0,
            outOfCityKmRate:  sessionOutOfCityRate || sessionCityRate,
            outOfCitySeconds: 0,
          };
        }

        (updateData as any)._breakdown = tripBreakdown;
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

  // ── Extract _breakdown BEFORE Prisma transaction ────────────────────────────
  // _breakdown is NOT a column in the Order model — it's only used for the
  // API response (driver app summary modal). Passing it to Prisma would throw
  // PrismaClientValidationError and silently fail the entire transaction,
  // leaving the order status stuck at "in_progress" in the database.
  const tripBreakdownForResponse = (updateData as any)._breakdown ?? null;
  delete (updateData as any)._breakdown;
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
      // Trip breakdown for the driver app summary modal (only on completion)
      breakdown: status === "completed" ? (tripBreakdownForResponse ?? null) : undefined,
    },
  });
}
