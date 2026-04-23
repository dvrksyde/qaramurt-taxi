export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// POST /api/driver/location — update GPS coordinates
export async function POST(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { lat, lng } = await req.json();

  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "lat и lng обязательны" }, { status: 400 });
  }

  // Update driver location in DB (WKT format for PostGIS) + fetch driver info for monitor
  const driver = await prisma.driver.update({
    where: { id: auth.driverId },
    data: {
      currentLocation: `POINT(${lng} ${lat})`,
      lastSeenAt: new Date(),
    } as any,
    include: {
      vehicles: { where: { isActive: true }, take: 1, select: { plate: true, make: true, model: true, color: true } },
    },
  });

  // Forward to monitor via Socket.io
  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    io.to("monitor").emit("driver_location_update", {
      driverId: auth.driverId,
      lat,
      lng,
      status: driver.status as string,
      callsign: driver.callsign,
      firstName: driver.firstName,
      lastName: driver.lastName,
      phone: driver.phone,
      plate: driver.vehicles[0]?.plate ?? null,
      vehicleLabel: driver.vehicles[0] ? `${driver.vehicles[0].make} ${driver.vehicles[0].model}` : null,
    });
  }

  return NextResponse.json({ ok: true });
}
