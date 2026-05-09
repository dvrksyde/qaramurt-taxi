export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

import { redis } from "@/lib/redis";

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// PATCH /api/driver/status — toggle online/offline
export async function PATCH(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { status } = await req.json(); // "free" or "offline"

  if (!["free", "offline"].includes(status)) {
    return NextResponse.json({ error: "Статус должен быть 'free' или 'offline'" }, { status: 400 });
  }

  // Version check — only when going online
  if (status === "free") {
    const minVersion = process.env.MIN_APP_VERSION ?? "1.0.0";
    const appVersion = req.headers.get("x-app-version") ?? "0.0.0";
    if (compareVersions(appVersion, minVersion) < 0) {
      return NextResponse.json(
        { error: `Версия приложения устарела (${appVersion}). Установите версию ${minVersion} или выше.`, forceUpdate: true },
        { status: 426 }
      );
    }
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
