export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// POST /api/driver/orders/[id]/accept — accept an order (first-come-first-served)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Check driver balance + get active vehicle
  const driver = await prisma.driver.findUnique({
    where: { id: auth.driverId },
    select: {
      balance: true,
      vehicles: { where: { isActive: true }, take: 1, select: { id: true } },
    },
  });

  if (driver && Number(driver.balance) < 100) {
    return NextResponse.json({
      error: "Недостаточный баланс (минимум 100 ₸). Пожалуйста, пополните счет."
    }, { status: 403 });
  }

  const activeVehicleId = driver?.vehicles?.[0]?.id ?? null;


  const { id } = await params;
  const orderId = parseInt(id);

  // Atomic: accept order AND check for existing active orders inside one transaction
  // This prevents the race condition where a driver accepts two orders simultaneously
  const result = await prisma.$transaction(async (tx) => {
    // Check for existing active order inside transaction to prevent TOCTOU race
    const existingOrder = await tx.order.findFirst({
      where: { driverId: auth.driverId, status: { in: ["assigned", "arrived", "in_progress"] } },
      select: { id: true },
    });
    if (existingOrder) return "has_active";

    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "pending" },
      data: {
        driverId: auth.driverId,
        status: "assigned",
        assignedAt: new Date(),
        ...(activeVehicleId ? { vehicleId: activeVehicleId } : {}),
      },
    });

    if (updated.count === 0) return null;

    await tx.driver.update({
      where: { id: auth.driverId },
      data: { status: "busy" },
    });

    await tx.orderStatusLog.create({
      data: { orderId, driverId: auth.driverId, status: "assigned" },
    });

    return updated;
  });

  if (result === "has_active") {
    return NextResponse.json({
      error: "У вас уже есть активный заказ. Сначала завершите текущую поездку."
    }, { status: 403 });
  }

  if (!result) {
    return NextResponse.json({ error: "Заказ уже занят" }, { status: 409 });
  }

  // Get full order for response
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      service: { select: { id: true, name: true } },
      class: { select: { id: true, name: true } },
    },
  });

  // Notify everyone
  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    // Tell monitor
    io.to("monitor").emit("order_status_change", {
      orderId,
      status: "assigned",
      driverId: auth.driverId,
    });
    // Tell all other drivers the order is taken
    io.to("drivers").emit("order_taken", { orderId });
  }

  return NextResponse.json({ data: order });
}
