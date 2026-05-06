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
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50")));
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

  const EXTRAS_MAP: Record<string, { key: string; label: string; price: number }> = {
    luggage:      { key: "luggage",      label: "Багаж",         price: 100 },
    roof_luggage: { key: "roof_luggage", label: "Верхний багаж", price: 200 },
    conditioner:  { key: "conditioner",  label: "Кондиционер",   price: 100 },
  };
  const optionsArr: { key: string; label: string; price: number }[] = [];
  if (hasLuggage)     optionsArr.push(EXTRAS_MAP.luggage);
  if (hasRoofLuggage) optionsArr.push(EXTRAS_MAP.roof_luggage);
  if (hasConditioner) optionsArr.push(EXTRAS_MAP.conditioner);

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
      // ── Multi-step radius expansion (handled by queue worker) ──────────────
      // Step 1: 1.5 km → Step 2: 3.0 km → Step 3: 5.0 km → Step 4: broadcast
      // Each step sorts by driver level (gold first), skips blocked drivers,
      // and waits 15 s before advancing if the order is still pending.
      try {
        const parseWkt = (wkt: string) => {
          const m = wkt.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/i);
          return m ? { lng: Number(m[1]), lat: Number(m[2]) } : null;
        };
        const pickup = parseWkt(order.pickupPoint);

        if (pickup) {
          // Small startup jitter (0-1 s) so simultaneous orders don't all
          // hit the worker at the exact same millisecond.
          const startJitter = Math.floor(Math.random() * 1000);
          await orderDistributionQueue.add(
            "dispatch-step",
            {
              orderId:     order.id,
              step:        1,
              notifiedIds: [],
              pickupLat:   pickup.lat,
              pickupLng:   pickup.lng,
              classId:     order.classId ?? null,
              alertData,
            },
            { delay: startJitter },
          );
        } else {
          // No parseable pickup point — fall back to broadcast
          io.to("drivers").emit("new_order_alert", alertData);
        }
      } catch (e) {
        console.error("[dispatch] Failed to queue dispatch-step:", e);
        io.to("drivers").emit("new_order_alert", alertData);
      }
    } else if (distributionMethod !== "map_pick" && distributionMethod !== "list_pick") {
      // broadcast / sequential / automatic without pickup point → notify all
      io.to("drivers").emit("new_order_alert", alertData);
    }
    
    // Notify the specific driver if assigned by dispatcher during creation
    if (assignedDriverId) {
      io.to(`driver:${assignedDriverId}`).emit("order_assigned_by_dispatcher", {
        orderId: order.id,
        order,
      });
    }
  }


  return NextResponse.json({ data: order }, { status: 201 });
}
