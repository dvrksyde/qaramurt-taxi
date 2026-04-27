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

    // Create trip session immediately — don't wait for app to call /trip/start
    // This ensures GPS distance is tracked even if app restarts mid-trip
    const baseFare = classObj?.name === "Комфорт" ? 390 : 290;
    let outOfCityKmRate = 0;
    if (classObj?.id) {
      try {
        const rows = await prisma.$queryRaw<Array<{ r: string }>>`
          SELECT "outOfCityKmRate" AS r FROM tariffs
          WHERE "classId" = ${classObj.id} AND "isActive" = true
          ORDER BY id ASC LIMIT 1
        `;
        outOfCityKmRate = Number(rows[0]?.r ?? 0);
      } catch { /* column not yet created */ }
    }

    let sessionId: number | null = null;
    try {
      const rows = await prisma.$queryRaw<Array<{ id: number }>>`
        INSERT INTO order_trip_sessions
          ("orderId", "driverId", "tariffPerKm", "outOfCityKmRate", "baseFare", "startedAt", status,
           "preliminaryDistanceKm", "pointsReceived", "lastIsOutOfCity", "outOfCityKm", "outOfCitySeconds",
           "createdAt", "updatedAt")
        VALUES
          (${order.id}, ${driver.id}, ${pricePerKm}, ${outOfCityKmRate}, ${baseFare},
           ${order.startedAt ?? new Date()}, 'active', 0, 0, false, 0, 0, NOW(), NOW())
        RETURNING id
      `;
      sessionId = rows[0]?.id ?? null;
    } catch {
      // Fallback: create without new columns (before db:push)
      try {
        const session = await prisma.orderTripSession.create({
          data: {
            orderId: order.id,
            driverId: driver.id,
            tariffPerKm: pricePerKm,
            baseFare,
            startedAt: order.startedAt ?? new Date(),
            status: "active",
          },
        });
        sessionId = session.id;
      } catch { /* session creation failed — app will retry via /trip/start */ }
    }

    return NextResponse.json({
      data: {
        ...order,
        _sessionId: sessionId,
        _baseFare: baseFare,           // server-computed base fare (class-aware)
        _cityRate: pricePerKm,         // server-computed city rate per km
        _outOfCityRate: outOfCityKmRate, // server-computed out-of-city rate (for client zone detection)
        // Include class explicitly so client can determine correct baseFare
        class: classObj ? { id: classObj.id, name: classObj.name } : null,
      },
      warning: Number(driver.balance) <= 100 ? "Ваш баланс ниже 100 ₸. Пожалуйста, пополните счет!" : undefined
    });
  } catch (error) {
    console.error("[curbside] Error creating curbside order:", error);
    return NextResponse.json({ error: "Ошибка создания заказа" }, { status: 500 });
  }
}
