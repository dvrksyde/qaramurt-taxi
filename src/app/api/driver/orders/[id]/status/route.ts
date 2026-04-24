export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { reverseGeocode } from "@/lib/geocoder";
import { isDeliveryOrder } from "@/lib/orderPricing";
import { computeWaitingTotals } from "@/lib/orderWaiting";
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

  const updateData: Record<string, unknown> = { status };
  const fixedPriceOrder = isDeliveryOrder(order);
  const currentBaseFare = order.class?.name === "Комфорт" ? 390 : BASE_FARE;
  const waitingTotals =
    status === "completed" || status === "canceled"
      ? computeWaitingTotals(order, new Date())
      : null;
  const waitingFee = Number(waitingTotals?.waitingFee ?? order.waitingFee ?? 0);

  if (status === "arrived") {
    updateData.arrivedAt = new Date();
  } else if (status === "in_progress") {
    updateData.startedAt = new Date();

    if (order.arrivedAt) {
      const waitMs = (updateData.startedAt as Date).getTime() - order.arrivedAt.getTime();
      const waitMins = Math.floor(waitMs / 60000);
      if (waitMins > 3) {
        const waitFeeBeforeTrip = (waitMins - 3) * 20;
        if (fixedPriceOrder) {
          updateData.estimatedPrice = Number(order.estimatedPrice || 0) + waitFeeBeforeTrip;
        }
      }
    }
  } else if (status === "completed") {
    updateData.completedAt = new Date();
    updateData.isWaiting = false;
    updateData.waitingStartedAt = null;
    updateData.waitingAccumulatedSeconds =
      waitingTotals?.waitingAccumulatedSeconds ?? Number(order.waitingAccumulatedSeconds || 0);
    updateData.waitingFee = waitingFee;

    if (typeof lat === "number" && typeof lng === "number") {
      updateData.dropoffPoint = `POINT(${lng} ${lat})`;
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
          // Ignore reverse geocode failures.
        }
      })();
    }

    if (fixedPriceOrder) {
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
        updateData.finalPrice = fixedPrice + waitingFee;
      }
    } else {
      const activeSession = await prisma.orderTripSession.findFirst({
        where: {
          orderId,
          driverId: auth.driverId,
          status: "active",
        },
        orderBy: { startedAt: "desc" },
      });

      if (activeSession) {
        try {
          const calc = await calculateSessionDistance(activeSession.id);

          if (calc.distanceKm > 0) {
            const finalPriceWithWaiting = calc.finalPrice + waitingFee;
            await completeSession(activeSession.id, calc.distanceKm, finalPriceWithWaiting);
            updateData.distanceKm = calc.distanceKm;
            updateData.finalPrice = finalPriceWithWaiting;
          } else {
            const fallbackFinalPrice =
              (clientFinalPrice ?? roundTo5(currentBaseFare)) + waitingFee;

            console.warn(`[trip/complete] Session ${activeSession.id} has < 2 points; using client fallback`);
            await completeSession(
              activeSession.id,
              clientDistanceKm ?? 0,
              fallbackFinalPrice
            );

            if (clientDistanceKm !== undefined) updateData.distanceKm = clientDistanceKm;
            updateData.finalPrice =
              clientFinalPrice !== undefined
                ? clientFinalPrice + waitingFee
                : roundTo5(currentBaseFare + Number(clientDistanceKm ?? 0) * Number(order.pricePerKm)) + waitingFee;
          }
        } catch (err) {
          console.error("[trip/complete] Server calc failed:", err);
          if (clientDistanceKm !== undefined) updateData.distanceKm = clientDistanceKm;
          updateData.finalPrice =
            clientFinalPrice !== undefined
              ? clientFinalPrice + waitingFee
              : clientDistanceKm !== undefined
                ? roundTo5(currentBaseFare + Number(clientDistanceKm) * Number(order.pricePerKm)) + waitingFee
                : undefined;
        }
      } else {
        if (clientDistanceKm !== undefined) {
          updateData.distanceKm = clientDistanceKm;
          updateData.finalPrice =
            roundTo5(currentBaseFare + Number(clientDistanceKm) * Number(order.pricePerKm)) + waitingFee;
        } else if (clientFinalPrice !== undefined) {
          updateData.finalPrice = clientFinalPrice + waitingFee;
        }
      }
    }
  } else if (status === "canceled") {
    updateData.canceledAt = new Date();
    updateData.isWaiting = false;
    updateData.waitingStartedAt = null;
    updateData.waitingAccumulatedSeconds =
      waitingTotals?.waitingAccumulatedSeconds ?? Number(order.waitingAccumulatedSeconds || 0);
    updateData.waitingFee = waitingFee;

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
      const defaultOp = await tx.operator.findFirst({ orderBy: { id: "asc" } });
      operatorId = defaultOp?.id ?? 1;
    }

    if (status === "completed" && updatedOrder.finalPrice) {
      const dTG = await tx.driver.findUnique({
        where: { id: auth.driverId },
        include: { tariffGroup: true },
      });

      const isCurbside =
        updatedOrder.pickupAddress === "С бордюра" ||
        updatedOrder.comment === "Заказ с бордюра";
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
