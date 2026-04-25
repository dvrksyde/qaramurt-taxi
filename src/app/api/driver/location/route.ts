export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";
import { redis } from "@/lib/redis";

// POST /api/driver/location — update GPS coordinates
export async function POST(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Rate limit: max 1 update per 3 seconds per driver
  const rateLimitKey = `driver:${auth.driverId}:loc_rl`;
  const blocked = await redis.set(rateLimitKey, "1", { NX: true, EX: 3 });
  if (!blocked) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { lat, lng } = await req.json();

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "lat и lng обязательны" }, { status: 400 });
  }

  const driverId = auth.driverId;
  const pointWkt = `POINT(${lng} ${lat})`;

  // Save latest location to Redis for fast access
  await redis.set(`driver:${driverId}:loc`, JSON.stringify({ lat, lng }), { EX: 3600 });
  await redis.geoAdd("driver_locations", { member: driverId.toString(), longitude: lng, latitude: lat });

  // Debounce DB updates (only update Postgres every 30 seconds per driver)
  const lastDbUpdateKey = `driver:${driverId}:last_db_update`;
  const lastUpdate = await redis.get(lastDbUpdateKey);
  
  let driverInfoStr = await redis.get(`driver:${driverId}:info`);
  let driverInfo = driverInfoStr ? JSON.parse(driverInfoStr) : null;

  if (!lastUpdate || !driverInfo) {
    // It's time to update DB, or we don't have driver info cached
    const updatedDriver = await prisma.driver.update({
      where: { id: driverId },
      data: { currentLocation: pointWkt },
      include: {
        vehicles: { where: { isActive: true }, take: 1, select: { plate: true, make: true, model: true, color: true } },
      },
    });

    driverInfo = {
      status: updatedDriver.status,
      callsign: updatedDriver.callsign,
      firstName: updatedDriver.firstName,
      lastName: updatedDriver.lastName,
      phone: updatedDriver.phone,
      plate: updatedDriver.vehicles[0]?.plate ?? null,
      vehicleLabel: updatedDriver.vehicles[0] ? `${updatedDriver.vehicles[0].make} ${updatedDriver.vehicles[0].model}` : null,
    };

    // Cache info for 60 seconds
    await redis.set(`driver:${driverId}:info`, JSON.stringify(driverInfo), { EX: 60 });
    // Mark last DB update (30s cooldown)
    await redis.set(lastDbUpdateKey, "1", { EX: 30 });
  }

  // Forward to monitor via Socket.io
  const io = (global as Record<string, unknown>).socketIO as any;
  if (io && driverInfo) {
    io.to("monitor").emit("driver_location_update", {
      driverId,
      lat,
      lng,
      ...driverInfo
    });
  }

  return NextResponse.json({ ok: true });
}

