export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateDriverLocation } from "@/lib/geo";
import { requireAuth, checkPermission } from "@/lib/permissions";
import { hashPassword } from "@/lib/passwords";
import { getDriverRank } from "@/lib/driverRanking";

type Params = { params: Promise<{ id: string }> };

async function serializeDriver(driver: any) {
  if (!driver) return null;

  const { passwordHash: _passwordHash, ...safeDriver } = driver;
  const driverRank = await getDriverRank(driver.id);

  return {
    ...safeDriver,
    balance: Number(driver.balance),
    maxCredit: Number(driver.maxCredit),
    rating: driverRank.rank,
    ordersCount: driverRank.ordersCount,
    currentLocation: null,
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { allowed, response } = await requireAuth();
  if (!allowed) return response!;

  const { id } = await params;
  const driver = await prisma.driver.findUnique({
    where: { id: parseInt(id, 10) },
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
  return NextResponse.json({ data: await serializeDriver(driver) });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { allowed, response } = await checkPermission(["edit_drivers"]);
  if (!allowed) return response!;

  const { id } = await params;
  const driverId = parseInt(id, 10);
  const body = await req.json();

  if (body.lat !== undefined && body.lng !== undefined) {
    await updateDriverLocation(driverId, body.lat, body.lng);

    const io = (global as Record<string, unknown>).socketIO as { to: (room: string) => { emit: (event: string, payload: unknown) => void } } | undefined;
    if (io) {
      io.to("monitor").emit("driver_location_update", {
        driverId,
        lat: body.lat,
        lng: body.lng,
        status: body.status || "free",
      });
    }
    return NextResponse.json({ success: true });
  }

  const {
    lastName,
    firstName,
    middleName,
    phone,
    login,
    callsign,
    comment,
    status,
    carPlate,
    carMake,
    carModel,
    carColor,
    carClassIds,
    password,
  } = body;

  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: {
      ...(lastName !== undefined && { lastName }),
      ...(firstName !== undefined && { firstName }),
      ...(middleName !== undefined && { middleName }),
      ...(phone !== undefined && { phone }),
      ...(login !== undefined && { login }),
      ...(callsign !== undefined && { callsign }),
      ...(comment !== undefined && { comment }),
      ...(status !== undefined && { status }),
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
    },
    include: { vehicles: true },
  });

  if (carPlate !== undefined) {
    if (updated.vehicles && updated.vehicles.length > 0) {
      await prisma.vehicle.update({
        where: { id: updated.vehicles[0].id },
        data: {
          plate: carPlate,
          make: carMake || "Неизвестно",
          model: carModel || "",
          color: carColor || "Неизвестно",
          ...(carClassIds !== undefined
            ? {
                classes: {
                  deleteMany: {},
                  create: carClassIds.map((cId: any) => ({ classId: Number(cId) })),
                },
              }
            : {}),
        },
      });
    } else if (carPlate) {
      await prisma.vehicle.create({
        data: {
          driverId,
          plate: carPlate,
          make: carMake || "Неизвестно",
          model: carModel || "",
          color: carColor || "Неизвестно",
          ownershipType: "driver",
          isActive: true,
          ...(carClassIds && carClassIds.length > 0
            ? {
                classes: {
                  create: carClassIds.map((cId: any) => ({ classId: Number(cId) })),
                },
              }
            : {}),
        },
      });
    }
  }

  const finalDriver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { vehicles: true },
  });

  return NextResponse.json({ data: await serializeDriver(finalDriver) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { allowed, response } = await checkPermission(["delete_drivers"]);
  if (!allowed) return response!;

  const { id } = await params;
  const driverId = parseInt(id, 10);

  try {
    await prisma.driver.delete({
      where: { id: driverId },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.code === "P2003") {
      await prisma.driver.update({
        where: { id: driverId },
        data: { isActive: false },
      });
      return NextResponse.json(
        {
          error: "Водитель переведен в статус удаленных, потому что полное удаление невозможно из-за связанных данных.",
          softDeleted: true,
        },
        { status: 400 },
      );
    }
    console.error("Error deleting driver", err);
    return NextResponse.json({ error: "Ошибка удаления водителя" }, { status: 500 });
  }
}
