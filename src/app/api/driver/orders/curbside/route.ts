export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

export async function POST(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const driver = await prisma.driver.findUnique({
    where: { id: auth.driverId },
    include: {
      tariffGroup: true,
      vehicles: { include: { classes: { include: { class: true } } } }
    },
  });

  if (!driver) {
    return NextResponse.json({ error: "Водитель не найден" }, { status: 404 });
  }

  if (Number(driver.balance) < 30) {
    return NextResponse.json({
      error: "Недостаточный баланс (минимум 30 ₸). Пожалуйста, пополните счет."
    }, { status: 403 });
  }

  if (driver.status !== "free") {
    return NextResponse.json({ error: "Вы должны быть свободны на линии" }, { status: 400 });
  }

  // Check if driver is already assigned to any active order
  const activeOrder = await prisma.order.findFirst({
    where: {
      driverId: auth.driverId,
      status: { in: ["assigned", "arrived", "in_progress"] },
    },
  });

  if (activeOrder) {
    return NextResponse.json({ error: "У вас уже есть активный заказ" }, { status: 400 });
  }

  const activeVehicle = driver.vehicles.find((v) => v.isActive);
  const classObj = activeVehicle?.classes?.[0]?.class;

  // Look up the actual tariff for the driver's vehicle class (most reliable source)
  let pricePerKm = 80;
  if (classObj?.id) {
    const tariff = await prisma.tariff.findFirst({
      where: { classId: classObj.id, isActive: true },
      orderBy: { id: "asc" },
      select: { pricePerKm: true },
    });
    if (tariff && Number(tariff.pricePerKm) > 0) {
      pricePerKm = Number(tariff.pricePerKm);
    }
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      // Create the curbside order
      const newOrder = await tx.order.create({
        data: {
          phone: "БОРДЮР",
          driverId: driver.id,
          vehicleId: activeVehicle?.id,
          classId: classObj?.id,
          pickupAddress: "С бордюра",
          status: "in_progress",
          comment: "Заказ с бордюра",
          pricePerKm: pricePerKm,
          startedAt: new Date(),
          assignedAt: new Date(),
          arrivedAt: new Date(),
        },
      });

      // Update driver status
      await tx.driver.update({
        where: { id: driver.id },
        data: { status: "busy" },
      });

      // Create initial order log
      await tx.orderStatusLog.create({
        data: {
          orderId: newOrder.id,
          driverId: driver.id,
          status: "in_progress",
        },
      });

      return newOrder;
    });

    const io = (global as Record<string, unknown>).socketIO as any;
    if (io) {
      io.to("monitor").emit("order_created", order);
      io.to("monitor").emit("order_status_change", {
        orderId: order.id,
        status: "in_progress",
        driverId: driver.id,
      });
      io.to("drivers").emit("driver_status_change", {
        driverId: driver.id,
        status: "busy",
        location: driver.currentLocation,
      });

      if (Number(driver.balance) <= 100) {
        const warningMsg = "Ваш баланс ниже 100 ₸. Пожалуйста, пополните счет во избежание блокировки!";
        io.to(`driver:${driver.id}`).emit("chat_message", {
          from: "Система",
          driverId: driver.id,
          text: warningMsg,
          timestamp: new Date().toISOString(),
          direction: "outbound"
        });
      }
    }

    return NextResponse.json({ 
      data: order,
      warning: Number(driver.balance) <= 100 ? "Ваш баланс ниже 100 ₸. Пожалуйста, пополните счет!" : undefined
    });
  } catch (error) {
    console.error("[curbside] Error creating curbside order:", error);
    return NextResponse.json({ error: "Ошибка создания заказа" }, { status: 500 });
  }
}
