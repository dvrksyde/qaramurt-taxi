export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

import { redis } from "@/lib/redis";

// PATCH /api/driver/status — toggle online/offline
export async function PATCH(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { status } = await req.json(); // "free" or "offline"

  if (!["free", "offline"].includes(status)) {
    return NextResponse.json({ error: "Статус должен быть 'free' или 'offline'" }, { status: 400 });
  }

  const driver = await prisma.driver.update({
    where: { id: auth.driverId },
    data: { status },
  });

  if (status === "offline") {
    // Keep Redis Geo index clean by removing offline drivers
    await redis.zRem("driver_locations", auth.driverId.toString()).catch(() => {});
    await redis.del(`driver:${auth.driverId}:info`).catch(() => {});
  }

  // Notify monitor
  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    if (status === "free") {
      io.to("monitor").emit("driver_online", { driverId: driver.id, callsign: driver.callsign });
    } else {
      io.to("monitor").emit("driver_offline", { driverId: driver.id });
    }
  }

  return NextResponse.json({ data: { id: driver.id, status: driver.status } });
}
