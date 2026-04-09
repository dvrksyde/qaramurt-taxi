export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { signDriverToken } from "@/lib/driverAuth";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";
import { getDriverRank } from "@/lib/driverRanking";

export async function POST(req: NextRequest) {
  const { login, password } = await req.json();

  if (!login || !password) {
    return NextResponse.json({ error: "Логин и пароль обязательны" }, { status: 400 });
  }

  const driver = await prisma.driver.findUnique({
    where: { login },
    include: {
      vehicles: {
        include: { classes: { include: { class: true } } },
      },
    },
  });

  if (!driver || !driver.isActive) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  const passwordCheck = await verifyPassword(password, driver.passwordHash);
  if (!passwordCheck.valid) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  if (passwordCheck.needsRehash) {
    await prisma.driver.update({
      where: { id: driver.id },
      data: { passwordHash: await hashPassword(password) },
    });
  }

  const token = signDriverToken({ driverId: driver.id, login: driver.login });
  const driverRank = await getDriverRank(driver.id);

  return NextResponse.json({
    data: {
      token,
      driver: {
        id: driver.id,
        firstName: driver.firstName,
        lastName: driver.lastName,
        callsign: driver.callsign,
        phone: driver.phone,
        balance: Number(driver.balance),
        rating: driverRank.rank,
        ordersCount: driverRank.ordersCount,
        status: driver.status,
        vehicle: driver.vehicles[0] || null,
      },
    },
  });
}
