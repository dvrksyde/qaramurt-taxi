export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { haversineKm, estimateMinutes, calculatePrice } from "@/lib/pricing";
import { getGeozoneOverride } from "@/lib/geo";

// GET /api/orders — list with filters
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "50");
  const driverId = searchParams.get("driverId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const where: Record<string, unknown> = {};

  if (statusParam) {
    const statuses = statusParam.split(",").map((s) => s.trim());
    where.status = { in: statuses };
  }
  if (driverId) where.driverId = parseInt(driverId);
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
  }

  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        driver: { select: { id: true, firstName: true, lastName: true, callsign: true } },
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
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    phone, serviceId, clientName, timing, scheduledAt,
    pickupAddress, dropoffAddress, stops, comment,
    classId, tariffId, cashlessAccountId, useBonuses,
    distributionMethod, optionIds, printReceipt, estimatedPrice,
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

  // Get or resolve operator ID from session
  const operatorLogin = (session.user as { email?: string })?.email;
  const operator = operatorLogin
    ? await prisma.operator.findUnique({ where: { login: operatorLogin }, select: { id: true } })
    : null;

  const order = await prisma.order.create({
    data: {
      phone,
      clientId: client?.id ?? null,
      serviceId: serviceId ? parseInt(serviceId) : null,
      operatorId: operator?.id ?? null,
      tariffId: tariffId ? parseInt(tariffId) : null,
      classId: classId ? parseInt(classId) : null,
      pickupAddress: pickupAddress || null,
      dropoffAddress: dropoffAddress || null,
      stops: stops || [],
      comment: comment || null,
      isScheduled: timing === "scheduled",
      scheduledAt: timing === "scheduled" && scheduledAt ? new Date(scheduledAt) : null,
      distributionMethod: distributionMethod || "automatic",
      estimatedPrice: estimatedPrice ?? null,
      useBonuses: useBonuses || false,
      cashlessAccountId: cashlessAccountId ? parseInt(cashlessAccountId) : null,
      printReceipt: printReceipt || false,
      status: "pending",
      options: optionIds?.length
        ? { create: optionIds.map((id: number) => ({ optionId: id })) }
        : undefined,
    },
    include: {
      driver: true,
      service: true,
      class: true,
    },
  });

  // Log initial status
  await prisma.orderStatusLog.create({
    data: { orderId: order.id, status: "pending" },
  });

  // Emit via Socket.io (if available)
  const io = (global as Record<string, unknown>).socketIO as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
  if (io) {
    io.to("monitor").emit("new_order", order);
    io.to("monitor").emit("order_updated", { orderId: order.id, method: distributionMethod });

    if (distributionMethod === "broadcast") {
      io.to("drivers").emit("new_order_alert", { orderId: order.id, method: "broadcast" });
    }
  }

  return NextResponse.json({ data: order }, { status: 201 });
}
