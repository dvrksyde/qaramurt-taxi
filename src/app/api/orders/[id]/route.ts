export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrderReadAccess, requireOrderWriteAccess } from "@/lib/operatorAccess";


type Params = { params: Promise<{ id: string }> };

// GET /api/orders/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const parsedId = parseInt(id);
    if (isNaN(parsedId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: parsedId },
      include: {
        driver: {
          include: {
            vehicles: { where: { isActive: true }, take: 1 },
          },
        },
        vehicle: true,
        service: true,
        class: true,
        operator: true,
        statusLogs: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Read geometry fields directly as plain text (no PostGIS needed)
    const rawPoints = await prisma.order.findUnique({
      where: { id: parsedId },
      select: { pickupPoint: true, dropoffPoint: true },
    });

    let driverPos = null;
    if (order.driverId) {
      const rawDriver = await prisma.driver.findUnique({
        where: { id: order.driverId },
        select: { currentLocation: true },
      });
      driverPos = rawDriver?.currentLocation || null;
    }

    const enrichedOrder = {
      ...order,
      pickupPoint: rawPoints?.pickupPoint || null,
      dropoffPoint: rawPoints?.dropoffPoint || null,
    };

    if (enrichedOrder.driver) {
      (enrichedOrder.driver as any).currentLocation = driverPos;
    }


    const access = await requireOrderReadAccess(order.operatorId);
    if (!access.allowed) return access.response!;
    
    return NextResponse.json({ data: enrichedOrder });
  } catch (error: any) {
    console.error("GET /api/orders/[id] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/orders/[id] — update status or fields
export async function PATCH(req: NextRequest, { params }: Params) {
  const access = await requireOrderWriteAccess();
  if (!access.allowed) return access.response!;

  const { id } = await params;
  const body = await req.json();
  const { status, driverId, vehicleId, finalPrice, cancelReason, source, options, extraPrice } = body;


  const now = new Date();
  const timestamps: Record<string, Date | null> = {};
  if (status === "assigned")    { timestamps.assignedAt = now; }
  if (status === "arrived")     { timestamps.arrivedAt = now; }
  if (status === "in_progress") { timestamps.startedAt = now; }
  if (status === "completed")   { timestamps.completedAt = now; }
  if (status === "canceled")    { timestamps.canceledAt = now; }

  // Use a transaction for atomic update of order and driver balance
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: parseInt(id) },
      data: {
        ...(status && { status }),
        ...(driverId !== undefined && { driverId }),
        ...(vehicleId !== undefined && { vehicleId }),
        ...(finalPrice !== undefined && { finalPrice }),
        ...(cancelReason && { cancelReason }),
        // Extra options: save JSON array
        ...(options !== undefined && { options }),
        // Recalculate estimated price when extras added (not on completed orders)
        ...(extraPrice !== undefined && !status && {
          estimatedPrice: extraPrice,
        }),
        ...timestamps,
      },
      include: { driver: true }
    });

    const operatorId = access.operatorId || 1; // Default to first operator if not in session

    // 1. Commission Deduction
    if (status === "completed" && updated.driverId && updated.finalPrice) {
      const driver = updated.driver;
      // Default to 15% (Standard) if no tariff is set
      // Fetch nested tariffGroup manually if not included or use a subquery/separate fetch.
      const dTG = await tx.driver.findUnique({
        where: { id: updated.driverId },
        include: { tariffGroup: true }
      });
      const commPercent = Number(dTG?.tariffGroup?.value || 15);
      const commission = Number(updated.finalPrice) * (commPercent / 100);

      if (commission > 0) {
        await tx.driver.update({
          where: { id: updated.driverId },
          data: { balance: { decrement: commission } }
        });
        await tx.cashTransaction.create({
          data: {
            driverId: updated.driverId,
            operatorId,
            orderId: updated.id,
            amount: commission,
            type: "order_fee",
            description: `Комиссия ${commPercent}% за заказ #${updated.id}`
          }
        });
      }
    }

    // 2. Cancellation Penalty (50 тг)
    if (status === "canceled" && source === "driver" && updated.driverId) {
      const penalty = 50;
      await tx.driver.update({
        where: { id: updated.driverId },
        data: { balance: { decrement: penalty } }
      });
      await tx.cashTransaction.create({
        data: {
          driverId: updated.driverId,
          operatorId,
          orderId: updated.id,
          amount: penalty,
          type: "penalty",
          description: `Штраф за отмену заказа #${updated.id}`
        }
      });
    }

    return updated;
  });

  const updated = result;

  // Log status change
  if (status) {
    await prisma.orderStatusLog.create({
      data: { orderId: updated.id, status, note: cancelReason || null },
    });
  }

  // Notify monitor via socket
  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    io.to("monitor").emit("order_status_change", { orderId: updated.id, status, driverId: updated.driverId });

    // Notify driver directly if options/price changed (no status change)
    if (!status && options !== undefined && updated.driverId) {
      io.to(`driver:${updated.driverId}`).emit("order_updated", {
        orderId: updated.id,
        estimatedPrice: updated.estimatedPrice,
        options: updated.options,
      });
    }
  }


  // Free driver if order completed or canceled
  if ((status === "completed" || status === "canceled") && updated.driverId) {
    await prisma.driver.update({
      where: { id: updated.driverId },
      data: { status: "free" },
    }).catch(console.error);
  }

  return NextResponse.json({ data: updated });
}

// DELETE /api/orders/[id] — cancel
export async function DELETE(_req: NextRequest, { params }: Params) {
  const access = await requireOrderWriteAccess();
  if (!access.allowed) return access.response!;

  const { id } = await params;
  const updated = await prisma.order.update({
    where: { id: parseInt(id) },
    data: { status: "canceled", canceledAt: new Date(), cancelReason: "Отменён оператором" },
  });

  // Log status change
  await prisma.orderStatusLog.create({
    data: { orderId: updated.id, status: "canceled", note: "Отменён оператором" },
  });

  // Notify monitor via socket
  const io = (global as Record<string, unknown>).socketIO as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
  if (io) {
    io.to("monitor").emit("order_status_change", { orderId: updated.id, status: "canceled", driverId: updated.driverId });
  }

  // Free driver if order canceled
  if (updated.driverId) {
    await prisma.driver.update({
      where: { id: updated.driverId },
      data: { status: "free" },
    }).catch(console.error);
  }

  return NextResponse.json({ data: updated });
}
