export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { haversineKm, estimateMinutes, calculatePrice } from "@/lib/pricing";
import { getGeozoneOverride } from "@/lib/geo";
import { checkPermission } from "@/lib/permissions";
import { redis } from "@/lib/redis";
import { orderDistributionQueue } from "@/lib/queue";

// GET /api/orders — list with filters
export async function GET(req: NextRequest) {
  // Need either journal_own or journal_all
  const { allowed, response, permissions, operatorId, role } = await checkPermission(["journal_own", "journal_all"]);
  if (!allowed) return response!;

  const isAdmin = role === "admin";
  const canSeeAll = isAdmin || (permissions || []).includes("journal_all");

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "50");
  const driverId = searchParams.get("driverId");
  const operatorIdParam = searchParams.get("operatorId");
  const phone = searchParams.get("phone");
  const address = searchParams.get("address");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const where: Record<string, unknown> = {};

  // If operator doesn't have journal_all, force filter to own orders
  if (!canSeeAll && operatorId) {
    where.operatorId = operatorId;
  }

  if (statusParam) {
    const statuses = statusParam.split(",").map((s) => s.trim());
    where.status = { in: statuses };
  }
  if (driverId) where.driverId = parseInt(driverId);
  if (operatorIdParam && canSeeAll) where.operatorId = parseInt(operatorIdParam);
  if (phone) where.phone = { contains: phone };
  if (address) {
    where.AND = [
      { OR: [
        { pickupAddress:  { contains: address, mode: "insensitive" } },
        { dropoffAddress: { contains: address, mode: "insensitive" } },
      ]},
    ];
  }
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
  }

  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        driver: { 
          select: { 
            id: true, firstName: true, lastName: true, callsign: true, phone: true,
            vehicles: { select: { plate: true, make: true, model: true, color: true } }
          } 
        },
        service: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
        operator: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ data, total, page, pageSize });
}

// POST /api/orders — create new order
export async function POST(req: NextRequest) {
  const { allowed, response: authResp, operatorId: currentOpId } = await checkPermission(["current_orders"]);
  if (!allowed) return authResp!;

  const body = await req.json();
  const {
    phone, serviceId, clientName, timing, scheduledAt,
    pickupAddress, dropoffAddress, stops, comment,
    classId, tariffId, cashlessAccountId, useBonuses,
    distributionMethod, optionIds, printReceipt, estimatedPrice,
    pricePerKm, pickupPoint, dropoffPoint, distanceKm,
    hasLuggage, hasRoofLuggage, hasConditioner,
    selectedDriverId,
  } = body;

  if (!phone) return NextResponse.json({ error: "Телефон обязателен" }, { status: 400 });

  // Upsert client
  let client = null;
  if (phone && phone.length > 2) {
    client = await prisma.client.upsert({
      where: { phone },
      update: clientName ? { name: clientName } : {},
      create: { phone, name: clientName || null },
    });
  }

  // Use operator ID from session
  const resolvedOperatorId = currentOpId;

  const optionsArr: string[] = [];
  if (hasLuggage) optionsArr.push("luggage");
  if (hasRoofLuggage) optionsArr.push("roof_luggage");
  if (hasConditioner) optionsArr.push("conditioner");

  // If dispatcher picked a driver manually (list_pick or map_pick)
  let assignedDriverId: number | null = null;
  let assignedVehicleId: number | null = null;
  if (selectedDriverId && (distributionMethod === "list_pick" || distributionMethod === "map_pick")) {
    const driver = await prisma.driver.findUnique({
      where: { id: parseInt(selectedDriverId) },
      include: { vehicles: { where: { isActive: true }, take: 1 } },
    });
    if (driver && driver.isActive) {
      if (Number(driver.balance) < 30) {
        return NextResponse.json({ 
          error: "У водителя недостаточный баланс (менее 30 ₸). Невозможно назначить заказ." 
        }, { status: 403 });
      }
      assignedDriverId = driver.id;
      assignedVehicleId = driver.vehicles[0]?.id ?? null;
    }
  }

  const order = await prisma.order.create({
    data: {
      phone,
      clientId: client?.id ?? null,
      serviceId: serviceId ? parseInt(serviceId) : null,
      operatorId: resolvedOperatorId ?? null,
      tariffId: tariffId ? parseInt(tariffId) : null,
      classId: classId ? parseInt(classId) : null,
      pickupAddress: pickupAddress || null,
      pickupPoint: pickupPoint && pickupPoint.length === 2 ? `POINT(${pickupPoint[1]} ${pickupPoint[0]})` : null,
      dropoffAddress: dropoffAddress || null,
      dropoffPoint: dropoffPoint && dropoffPoint.length === 2 ? `POINT(${dropoffPoint[1]} ${dropoffPoint[0]})` : null,
      stops: stops || [],
      comment: comment || null,
      options: optionsArr,
      isScheduled: timing === "scheduled",
      scheduledAt: timing === "scheduled" && scheduledAt ? new Date(scheduledAt) : null,
      distributionMethod: distributionMethod || "automatic",
      estimatedPrice: estimatedPrice ?? null,
      useBonuses: useBonuses || false,
      cashlessAccountId: cashlessAccountId ? parseInt(cashlessAccountId) : null,
      printReceipt: printReceipt || false,
      pricePerKm: pricePerKm ? parseInt(pricePerKm) : 80,
      distanceKm: distanceKm ?? null,
      // If driver was manually selected — assign immediately
      ...(assignedDriverId ? {
        driverId: assignedDriverId,
        vehicleId: assignedVehicleId,
        status: "assigned",
        assignedAt: new Date(),
      } : {
        status: "pending",
      }),
    },
    include: {
      driver: true,
      service: true,
      class: true,
    },
  });

  // If driver was assigned, set them to busy
  if (assignedDriverId) {
    await prisma.driver.update({
      where: { id: assignedDriverId },
      data: { status: "busy" },
    }).catch(() => {});
  }

  // Log initial status
  await prisma.orderStatusLog.create({
    data: { orderId: order.id, status: "pending" },
  });

  // Emit via Socket.io (if available)
  const io = (global as Record<string, unknown>).socketIO as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
  if (io) {
    io.to("monitor").emit("new_order", order);
    io.to("monitor").emit("order_updated", { orderId: order.id, method: distributionMethod });

    const alertData = {
      orderId: order.id,
      phone: order.phone,
      pickupAddress: order.pickupAddress,
      classId: order.classId,
      pricePerKm: order.pricePerKm,
      createdAt: order.createdAt,
      method: distributionMethod
    };

    if (distributionMethod === "automatic" && order.pickupPoint) {
      // Find drivers in 5km radius
      try {
        const parseWkt = (wkt: string) => {
          const m = wkt.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/i);
          return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
        };

        const pickup = parseWkt(order.pickupPoint);
                const CLOSE_RADIUS_KM = 2.5; // Первая волна (ближайшие)
        const MAX_RADIUS_KM = 5.0; // Вторая волна

        let closeDrivers: {id: number, dist: number}[] = [];
        let farDrivers: {id: number, dist: number}[] = [];

        if (pickup) {
          const nearbyDriverMembers = await redis.geoSearchWith(
            "driver_locations", 
            { longitude: pickup.lng, latitude: pickup.lat },
            { radius: MAX_RADIUS_KM, unit: "km" },
            ["WITHDIST", "ASC"]
          ) as any[];

          const nearbyDriverIds = nearbyDriverMembers.map(d => Number(d.member));

          if (nearbyDriverIds.length > 0) {
            const validDrivers = await prisma.driver.findMany({
              where: { 
                id: { in: nearbyDriverIds },
                status: "free", 
                balance: { gte: 30 },
                ...(order.classId ? {
                  vehicles: {
                    some: {
                      isActive: true,
                      classes: { some: { classId: order.classId } }
                    }
                  }
                } : {})
              },
              select: { id: true }
            });

            const validDriverIds = new Set(validDrivers.map(d => d.id));

            const validWithDist = nearbyDriverMembers
              .filter(d => validDriverIds.has(Number(d.member)))
              .map(d => ({ id: Number(d.member), dist: Number(d.distance || 0) }));

            closeDrivers = validWithDist.filter((d) => d.dist <= CLOSE_RADIUS_KM);
            farDrivers = validWithDist.filter((d) => d.dist > CLOSE_RADIUS_KM);
          }
        }

        if (closeDrivers.length > 0) {
          // Шаг 1: Отправляем только ближайшим (до 2.5 км)
          closeDrivers.forEach((d) => {
            io.to(`driver:${d.id}`).emit("new_order_alert", alertData);
          });

          // Шаг 2: Ждем 15 секунд. Если никто из ближайших не взял, расширяем радиус до 5 км
          await orderDistributionQueue.add("expand-radius", {
            orderId: order.id,
            alertData,
            farDriverIds: farDrivers.map((d) => d.id)
          }, { delay: 15000 });
          
        } else if (farDrivers.length > 0) {
          // Если в радиусе 2.5 км никого нет, сразу отправляем тем, кто в пределах 5 км
          farDrivers.forEach((d) => {
            io.to(`driver:${d.id}`).emit("new_order_alert", alertData);
          });
        } else {
          // Если вообще никого нет в радиусе 5 км, кидаем всем
          io.to("drivers").emit("new_order_alert", alertData);
        }
      } catch (e) {
        console.error("Auto distribution error", e);
        // Fallback on error
        io.to("drivers").emit("new_order_alert", alertData);
      }
    } else if (distributionMethod !== "map_pick" && distributionMethod !== "list_pick") {
      // Broadcast to ALL online drivers for 'broadcast', 'sequential', or if automatic without pickup point
      io.to("drivers").emit("new_order_alert", alertData);
    }
  }

  return NextResponse.json({ data: order }, { status: 201 });
}
