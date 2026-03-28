export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateDriverLocation } from "@/lib/geo";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const driver = await prisma.driver.findUnique({
    where: { id: parseInt(id) },
    include: {
      tariffGroup: true,
      vehicles: { include: { classes: { include: { class: true } } } },
      documents: { orderBy: { createdAt: "desc" } },
      orders: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, status: true, createdAt: true, finalPrice: true },
      },
    },
  });

  if (!driver) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    data: {
      ...driver,
      balance: Number(driver.balance),
      maxCredit: Number(driver.maxCredit),
      rating: Number(driver.rating),
      currentLocation: null,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const driverId = parseInt(id);
  const body = await req.json();

  // Handle GPS location update separately
  if (body.lat !== undefined && body.lng !== undefined) {
    await updateDriverLocation(driverId, body.lat, body.lng);

    // Notify monitor
    const io = (global as Record<string, unknown>).socketIO as { to: (r: string) => { emit: (e: string, d: unknown) => void } } | undefined;
    if (io) {
      io.to("monitor").emit("driver_location_update", {
        driverId, lat: body.lat, lng: body.lng, status: body.status || "free",
      });
    }
    return NextResponse.json({ success: true });
  }

  const { lastName, firstName, middleName, phone, callsign, tariffGroupId, maxCredit, comment, status } = body;

  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: {
      ...(lastName    !== undefined && { lastName }),
      ...(firstName   !== undefined && { firstName }),
      ...(middleName  !== undefined && { middleName }),
      ...(phone       !== undefined && { phone }),
      ...(callsign    !== undefined && { callsign }),
      ...(tariffGroupId !== undefined && { tariffGroupId: tariffGroupId ? parseInt(tariffGroupId) : null }),
      ...(maxCredit   !== undefined && { maxCredit: parseFloat(maxCredit) }),
      ...(comment     !== undefined && { comment }),
      ...(status      !== undefined && { status }),
    },
  });

  return NextResponse.json({ data: { ...updated, balance: Number(updated.balance) } });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await prisma.driver.update({
    where: { id: parseInt(id) },
    data: { isActive: false },
  });
  return NextResponse.json({ success: true });
}
