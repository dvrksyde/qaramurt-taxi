export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkPermission } from "@/lib/permissions";
import { hashPassword } from "@/lib/passwords";
import { buildDriverRankMap } from "@/lib/driverRanking";

function serializeDriver(driver: any, rating: number, ordersCount: number) {
  const { passwordHash: _passwordHash, ...safeDriver } = driver;
  return {
    ...safeDriver,
    balance: Number(driver.balance),
    maxCredit: Number(driver.maxCredit),
    rating,
    ordersCount,
    currentLocation: null,
    tariffGroup: driver.tariffGroup,
    tariffGroupId: driver.tariffGroupId,
  };
}

export async function GET(req: NextRequest) {
  const { allowed, response } = await requireAuth();
  if (!allowed) return response!;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  const where: Record<string, unknown> = { isActive: true };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { lastName: { contains: search, mode: "insensitive" } },
      { firstName: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { callsign: { contains: search, mode: "insensitive" } },
    ];
  }

  const drivers = await prisma.driver.findMany({
    where,
    include: {
      tariffGroup: { select: { name: true, type: true } },
      vehicles: { select: { id: true, plate: true, make: true, model: true, color: true, classes: true } },
      _count: { select: { orders: { where: { status: "completed" } } } },
    },
    orderBy: [{ status: "asc" }, { lastName: "asc" }],
  });

  const rankMap = buildDriverRankMap(
    drivers.map((driver) => ({
      id: driver.id,
      ordersCount: driver._count?.orders || 0,
    })),
  );

  const serialized = drivers.map((driver) => {
    const rankEntry = rankMap.get(driver.id) || { rank: 0, ordersCount: 0 };
    return serializeDriver(driver, rankEntry.rank, rankEntry.ordersCount);
  });

  return NextResponse.json({ data: serialized });
}

export async function POST(req: NextRequest) {
  const { allowed, response } = await checkPermission(["add_drivers"]);
  if (!allowed) return response!;

  const body = await req.json();
  let {
    lastName,
    firstName,
    middleName,
    phone,
    login,
    password,
    callsign,
    comment,
    carPlate,
    carMake,
    carModel,
    carColor,
    carClassIds,
    autoGenCreds,
    tariffGroupId,
  } = body;

  let generatedPassword = null;

  if (autoGenCreds) {
    if (!login) {
      login = phone.replace(/\D/g, "").slice(-10);
      if (!login) login = `dr${Math.floor(1000 + Math.random() * 9000)}`;
    }
    if (!password) {
      password = Math.random().toString(36).substring(2, 8).toUpperCase();
      generatedPassword = password;
    }
  }

  if (!lastName || !firstName || !phone || !login || !password) {
    return NextResponse.json({ error: "Заполните обязательные поля" }, { status: 400 });
  }

  const exists = await prisma.driver.findFirst({
    where: { OR: [{ phone }, { login }] },
  });
  if (exists) {
    return NextResponse.json({ error: "Телефон или логин уже используется" }, { status: 409 });
  }

  // Default to Стандарт if no tariff provided
  let finalTariffId = tariffGroupId ? Number(tariffGroupId) : null;
  if (!finalTariffId) {
    const standard = await prisma.driverTariffGroup.findFirst({ where: { name: "Стандарт" } });
    if (standard) finalTariffId = standard.id;
  }

  const driver = await prisma.driver.create({
    data: {
      lastName,
      firstName,
      middleName: middleName || null,
      phone,
      login,
      passwordHash,
      callsign: callsign || null,
      comment: comment || null,
      status: "offline",
      tariffGroupId: finalTariffId,
      ...(carPlate
        ? {
            vehicles: {
              create: {
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
            },
          }
        : {}),
    },
    include: {
      tariffGroup: { select: { name: true, type: true } },
      vehicles: true,
      _count: { select: { orders: { where: { status: "completed" } } } },
    },
  });

  return NextResponse.json(
    { data: serializeDriver(driver, 0, driver._count?.orders || 0), generatedPassword },
    { status: 201 },
  );
}
