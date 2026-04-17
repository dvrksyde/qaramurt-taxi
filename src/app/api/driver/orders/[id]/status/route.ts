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
    include: { service: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = { status };
  const fixedPriceOrder = isDeliveryOrder(order);

  if (status === "arrived") {
    updateData.arrivedAt = new Date();
  } else if (status === "in_progress") {
    updateData.startedAt = new Date();
  } else if (status === "completed") {
    updateData.completedAt = new Date();

    // Save dropoff coordinates if provided
    if (typeof lat === "number" && typeof lng === "number") {
      updateData.dropoffPoint = `POINT(${lng} ${lat})`;
      const address = await reverseGeocode(lat, lng);
      if (address) {
        updateData.dropoffAddress = address;
      }
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
        try {
          const calc = await calculateSessionDistance(activeSession.id);

          if (calc.distanceKm > 0) {
            // GPS session has enough points — use server calculation
            await completeSession(activeSession.id, calc.distanceKm, calc.finalPrice);
            updateData.distanceKm = calc.distanceKm;
            updateData.finalPrice = calc.finalPrice;
          } else {
            // < 2 GPS points (bad GPS / very short trip) — use client backup
            console.warn(`[trip/complete] Session ${activeSession.id} has < 2 points; using client fallback`);
            await completeSession(
              activeSession.id,
              clientDistanceKm ?? 0,
              clientFinalPrice ?? roundTo5(BASE_FARE)
            );
            if (clientDistanceKm !== undefined) updateData.distanceKm = clientDistanceKm;
            updateData.finalPrice =
              clientFinalPrice ??
              roundTo5(BASE_FARE + Number(clientDistanceKm ?? 0) * Number(order.pricePerKm));
          }
        } catch (err) {
          console.error("[trip/complete] Server calc failed:", err);
          // Graceful fallback: use client values if server calc throws
          if (clientDistanceKm !== undefined) updateData.distanceKm = clientDistanceKm;
          updateData.finalPrice =
            clientFinalPrice ??
            (clientDistanceKm !== undefined
              ? roundTo5(BASE_FARE + Number(clientDistanceKm) * Number(order.pricePerKm))
              : undefined);
        }
      } else {
        // No GPS session — fall back to client-reported values
        if (clientDistanceKm !== undefined) {
          updateData.distanceKm = clientDistanceKm;
          updateData.finalPrice = roundTo5(BASE_FARE + Number(clientDistanceKm) * Number(order.pricePerKm));
        } else if (clientFinalPrice !== undefined) {
          updateData.finalPrice = clientFinalPrice;
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

    const operatorId = updatedOrder.operatorId ?? 1;

    if (status === "completed" && updatedOrder.finalPrice) {
      const dTG = await tx.driver.findUnique({
        where: { id: auth.driverId },
        include: { tariffGroup: true }
      });
      const commPercent = Number(dTG?.tariffGroup?.value || 15);
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
    select: { distanceKm: true, finalPrice: true },
  });

  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    io.to("monitor").emit("order_status_change", {
      orderId,
      status,
      driverId: auth.driverId,
      distanceKm: finalOrder?.distanceKm,
      finalPrice: finalOrder?.finalPrice,
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
    },
  });
}
