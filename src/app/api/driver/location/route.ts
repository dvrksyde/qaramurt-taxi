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

  // Update driver location in DB (WKT format for PostGIS)
  await prisma.driver.update({
    where: { id: auth.driverId },
    data: { currentLocation: `POINT(${lng} ${lat})` },
  });

  // Forward to monitor via Socket.io
  const io = (global as Record<string, unknown>).socketIO as any;
  if (io) {
    io.to("monitor").emit("driver_location_update", {
      driverId: auth.driverId,
      lat,
      lng,
      status: "free",
    });
  }

  return NextResponse.json({ ok: true });
}
