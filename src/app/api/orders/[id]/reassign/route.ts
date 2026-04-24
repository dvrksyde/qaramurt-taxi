export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrderWriteAccess } from "@/lib/operatorAccess";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/reassign
 * Body: { newDriverId: number }
 *
 * 1. Frees the current driver (sets status → free)
 * 2. Assigns the new driver (sets status → busy)
 * 3. Updates the order (driverId, status → assigned, assignedAt = now)
 * 4. Creates a status log entry
 * 5. Notifies monitor + old/new driver via socket
 */
export async function POST(req: NextRequest, { params }: Params) {
  const access = await requireOrderWriteAccess();
  if (!access.allowed) return access.response!;

  const { id } = await params;
  const orderId = parseInt(id);
  const body = await req.json();
  const newDriverId: number = body.newDriverId;

  if (!newDriverId) {
    return NextResponse.json({ error: "newDriverId is required" }, { status: 400 });
  }

  // Validate target driver exists and is active
  const newDriver = await prisma.driver.findUnique({
    where: { id: newDriverId },
    include: { vehicles: { where: { isActive: true }, take: 1 } },
  });

  if (!newDriver) {
    return NextResponse.json({ error: "Водитель не найден" }, { status: 404 });
  }
  if (!newDriver.isActive) {
    return NextResponse.json({ error: "Водитель заблокирован" }, { status: 403 });
  }
  if (Number(newDriver.balance) < 30) {
    return NextResponse.json({ 
      error: "У водителя недостаточный баланс (менее 30 ₸). Невозможно назначить заказ." 
    }, { status: 403 });
  }

  // Get current order
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  }
  if (order.status === "completed" || order.status === "canceled") {
    return NextResponse.json({ error: "Нельзя переназначить завершённый или отменённый заказ" }, { status: 400 });
  }

  const previousDriverId = order.driverId;

  // Atomic transaction
  const updated = await prisma.$transaction(async (tx) => {
    // 1. Free old driver
    if (previousDriverId && previousDriverId !== newDriverId) {
      await tx.driver.update({
        where: { id: previousDriverId },
        data: { status: "free" },
      });
    }

    // 2. Set new driver to busy
    await tx.driver.update({
      where: { id: newDriverId },
      data: { status: "busy" },
    });

    // 3. Update order
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        driverId: newDriverId,
        vehicleId: newDriver.vehicles[0]?.id ?? order.vehicleId,
        status: "assigned",
        assignedAt: new Date(),
      },
      include: {
        driver: true,
        vehicle: true,
        service: true,
        class: true,
        operator: true,
      },
    });

    // 4. Log
    await tx.orderStatusLog.create({
      data: {
        orderId,
        driverId: newDriverId,
        status: "assigned",
        note: previousDriverId
          ? `Переназначен с водителя #${previousDriverId} на #${newDriverId}`
          : `Назначен водитель #${newDriverId}`,
      },
    });

    return updatedOrder;
  });

  // 5. Notify via socket
  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    // Update monitor
    io.to("monitor").emit("order_status_change", {
      orderId,
      status: "assigned",
      driverId: newDriverId,
    });

    // Notify old driver: their order was taken away
    if (previousDriverId && previousDriverId !== newDriverId) {
      io.to(`driver:${previousDriverId}`).emit("order_reassigned", {
        orderId,
        message: "Диспетчер снял с вас заказ",
      });
    }

    // Notify new driver: they got assigned
    io.to(`driver:${newDriverId}`).emit("order_assigned_by_dispatcher", {
      orderId,
      order: updated,
    });
  }

  return NextResponse.json({ data: updated });
}
