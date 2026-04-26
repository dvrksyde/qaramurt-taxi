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

  // Validate status transition
  const allowedTransitions: Record<string, string[]> = {
    assigned:    ["arrived", "canceled"],
    arrived:     ["in_progress", "canceled"],
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
        // Session baseFare includes: class base fare + arrival wait + options (set in trip/start)
        const sessionBaseFare = Number(activeSession.baseFare) || currentBaseFare;
        // Mid-trip waiting fee (driver pressed ⏸ during the ride)
        const midTripWaitFee = Number(order.waitingFee || 0);

        try {
          const calc = await calculateSessionDistance(activeSession.id);

          if (calc.distanceKm > 0) {
            // Add mid-trip waiting fee to server-calculated price
            const serverPrice = Math.max(calc.finalPrice, sessionBaseFare) + midTripWaitFee;
            await completeSession(activeSession.id, calc.distanceKm, serverPrice, calc.outOfCityKm, calc.outOfCitySeconds);
            updateData.distanceKm = calc.distanceKm;
            updateData.finalPrice = serverPrice;
          } else {
            console.warn(`[trip/complete] Session ${activeSession.id} has < 2 points; using client fallback`);
            const fallbackPrice = Math.max(
              clientFinalPrice ?? roundTo5(sessionBaseFare),
              sessionBaseFare
            );
            await completeSession(activeSession.id, clientDistanceKm ?? 0, fallbackPrice);
            if (clientDistanceKm !== undefined) updateData.distanceKm = clientDistanceKm;
            updateData.finalPrice = fallbackPrice;
          }
        } catch (err) {
          console.error("[trip/complete] Server calc failed:", err);
          if (clientDistanceKm !== undefined) updateData.distanceKm = clientDistanceKm;
          const fallbackPrice = clientDistanceKm !== undefined
            ? roundTo5(sessionBaseFare + Number(clientDistanceKm) * Number(order.pricePerKm)) + midTripWaitFee
            : sessionBaseFare + midTripWaitFee;
          updateData.finalPrice = Math.max(
            clientFinalPrice ?? fallbackPrice,
            sessionBaseFare
          );
        }
      } else {
        // No GPS session — fall back to client-reported values
        if (clientDistanceKm !== undefined) {
          updateData.distanceKm = clientDistanceKm;
          // Enforce minimum: client cannot report a price below base fare
          const computed = roundTo5(currentBaseFare + Number(clientDistanceKm) * Number(order.pricePerKm));
          updateData.finalPrice = Math.max(computed, currentBaseFare);
        } else if (clientFinalPrice !== undefined) {
          // Enforce minimum regardless of what client sends
          updateData.finalPrice = Math.max(Number(clientFinalPrice), currentBaseFare);
        } else {
          // Absolute fallback — never leave finalPrice null on completion
          updateData.finalPrice = currentBaseFare;
        }
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

      const isCurbside = updatedOrder.pickupAddress === "С бордюра" || updatedOrder.comment === "Заказ с бордюра";
      const commPercent = isCurbside ? 10 : Number(dTG?.tariffGroup?.value || 15);
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
            description: isCurbside
              ? `Комиссия ${commPercent}% (С бордюра) за заказ #${orderId}`
              : `Комиссия ${commPercent}% за заказ #${orderId}`,
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
    },
  });
}
