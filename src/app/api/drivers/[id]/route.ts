export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateDriverLocation } from "@/lib/geo";
import { requireAuth, checkPermission } from "@/lib/permissions";
import { hashPassword } from "@/lib/passwords";

function serializeDriver(driver: any) {
  if (!driver) return null;

  const { passwordHash: _passwordHash, ...safeDriver } = driver;
  return {
    ...safeDriver,
    balance: Number(driver.balance),
    maxCredit: Number(driver.maxCredit),
    rating: Number(driver.rating),
    currentLocation: null,
  };
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { allowed, response } = await requireAuth();
  if (!allowed) return response!;

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
  return NextResponse.json({ data: serializeDriver(driver) });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { allowed, response } = await checkPermission(["edit_drivers"]);
  if (!allowed) return response!;

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

  const {
    lastName, firstName, middleName, phone, callsign, comment, status,
    carPlate, carMake, carModel, carColor, carClassIds, password,
  } = body;

  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: {
      ...(lastName    !== undefined && { lastName }),
      ...(firstName   !== undefined && { firstName }),
      ...(middleName  !== undefined && { middleName }),
      ...(phone       !== undefined && { phone }),
      ...(callsign    !== undefined && { callsign }),
      ...(comment     !== undefined && { comment }),
      ...(status      !== undefined && { status }),
      ...(password    ? { passwordHash: await hashPassword(password) } : {}),
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
          ...(carClassIds !== undefined ? {
            classes: {
              deleteMany: {},
              create: carClassIds.map((cId: any) => ({ classId: Number(cId) }))
            }
          } : {})
        }
      });
    } else if (carPlate) {
      await prisma.vehicle.create({
        data: {
          driverId: driverId,
          plate: carPlate,
          make: carMake || "Неизвестно",
          model: carModel || "",
          color: carColor || "Неизвестно",
          ownershipType: "driver",
          isActive: true,
          ...(carClassIds && carClassIds.length > 0 ? {
            classes: {
               create: carClassIds.map((cId: any) => ({ classId: Number(cId) }))
            }
          } : {})
        }
      });
    }
  }

  const finalDriver = await prisma.driver.findUnique({ where: { id: driverId }, include: { vehicles: true } });

  return NextResponse.json({ data: serializeDriver(finalDriver) });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { allowed, response } = await checkPermission(["delete_drivers"]);
  if (!allowed) return response!;

  const { id } = await params;
  const driverId = parseInt(id);

  try {
    // Attempt physical deletion
    await prisma.driver.delete({
      where: { id: driverId },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.code === "P2003") {
      // If foreign keys prevent deletion, do a soft delete
      await prisma.driver.update({
        where: { id: driverId },
        data: { isActive: false },
      });
      return NextResponse.json(
        { 
          error: "Водитель переведён в статус 'удалённых' (отключён), так как полное удаление невозможно из-за привязанных автомобилей, поездок или транзакций.",
          softDeleted: true
        },
        { status: 400 }
      );
    }
    console.error("Error deleting driver", err);
    return NextResponse.json({ error: "Ошибка удаления водителя" }, { status: 500 });
  }
}
