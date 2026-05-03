export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { hashPassword } from "@/lib/passwords";
import { getDriverLevel } from "@/lib/driverRanking";

async function buildDriverProfile(driverId: number) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: {
      vehicles: {
        include: { classes: { include: { class: true } } },
      },
      tariffGroup: true,
    },
  });

  if (!driver || !driver.isActive) {
    return null;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayOrders, todayEarnings, driverRank] = await Promise.all([
    prisma.order.count({
      where: { driverId: driver.id, status: "completed", completedAt: { gte: todayStart } },
    }),
    prisma.order.aggregate({
      where: { driverId: driver.id, status: "completed", completedAt: { gte: todayStart } },
      _sum: { finalPrice: true },
    }),
    getDriverLevel(driver.id),
  ]);

  return {
    id: driver.id,
    firstName: driver.firstName,
    lastName: driver.lastName,
    middleName: driver.middleName,
    login: driver.login,
    callsign: driver.callsign,
    phone: driver.phone,
    balance: Number(driver.balance),
    level: driverRank.level,
    levelScore: driverRank.score,
    ordersCount: driverRank.ordersCount,
    completionRate: driverRank.completionRate,
    cancellationCount: driverRank.cancellationCount,
    status: driver.status,
    vehicle: driver.vehicles[0] || null,
    tariffGroup: driver.tariffGroup,
    todayOrders,
    todayEarnings: Number(todayEarnings._sum.finalPrice || 0),
  };
}

export async function GET(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const profile = await buildDriverProfile(auth.driverId);
  if (!profile) {
    return NextResponse.json({ error: "Водитель не найден" }, { status: 404 });
  }

  return NextResponse.json({ data: profile });
}

export async function PATCH(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const body = await req.json();
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const middleName = typeof body.middleName === "string" ? body.middleName.trim() : undefined;
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const password = typeof body.password === "string" ? body.password.trim() : "";

  if (!firstName || !lastName || !phone) {
    return NextResponse.json({ error: "Имя, фамилия и номер телефона обязательны" }, { status: 400 });
  }

  if (password && password.length < 6) {
    return NextResponse.json({ error: "Пароль должен содержать минимум 6 символов" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {
    firstName,
    lastName,
    phone,
    middleName: middleName || null,
  };

  if (password) {
    updateData.passwordHash = await hashPassword(password);
  }

  try {
    await prisma.driver.update({
      where: { id: auth.driverId },
      data: updateData,
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Этот номер уже используется" }, { status: 409 });
    }
    throw error;
  }

  const profile = await buildDriverProfile(auth.driverId);
  if (!profile) {
    return NextResponse.json({ error: "Водитель не найден" }, { status: 404 });
  }

  return NextResponse.json({ data: profile });
}
