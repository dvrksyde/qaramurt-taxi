export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

// GET /api/orders/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id: parseInt(id) },
    include: {
      driver: true,
      vehicle: true,
      service: true,
      class: true,
      operator: true,
      statusLogs: { orderBy: { createdAt: "asc" } },
      options: { include: { option: true } },
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: order });
}

// PATCH /api/orders/[id] — update status or fields
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { status, driverId, vehicleId, finalPrice, cancelReason } = body;

  const now = new Date();
  const timestamps: Record<string, Date | null> = {};
  if (status === "assigned")    { timestamps.assignedAt = now; }
  if (status === "arrived")     { timestamps.arrivedAt = now; }
  if (status === "in_progress") { timestamps.startedAt = now; }
  if (status === "completed")   { timestamps.completedAt = now; }
  if (status === "canceled")    { timestamps.canceledAt = now; }

  const updated = await prisma.order.update({
    where: { id: parseInt(id) },
    data: {
      ...(status && { status }),
      ...(driverId !== undefined && { driverId }),
      ...(vehicleId !== undefined && { vehicleId }),
      ...(finalPrice !== undefined && { finalPrice }),
      ...(cancelReason && { cancelReason }),
      ...timestamps,
    },
  });

  // Log status change
  if (status) {
    await prisma.orderStatusLog.create({
      data: { orderId: updated.id, status, note: cancelReason || null },
    });
  }

  // Notify monitor via socket
  const io = (global as Record<string, unknown>).socketIO as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
  if (io) {
    io.to("monitor").emit("order_status_change", { orderId: updated.id, status, driverId });
  }

  // Free driver if order completed or canceled
  if ((status === "completed" || status === "canceled") && driverId) {
    await prisma.driver.update({
      where: { id: driverId },
      data: { status: "free" },
    }).catch(console.error);
  }

  return NextResponse.json({ data: updated });
}

// DELETE /api/orders/[id] — cancel
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const updated = await prisma.order.update({
    where: { id: parseInt(id) },
    data: { status: "canceled", canceledAt: new Date(), cancelReason: "Отменён оператором" },
  });
  return NextResponse.json({ data: updated });
}
