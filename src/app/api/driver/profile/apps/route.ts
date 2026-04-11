export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// POST /api/driver/profile/apps — save detected installed taxi apps
export async function POST(req: NextRequest) {
  const auth = verifyDriverToken(req);
  if (!auth) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = await req.json();
  const apps = Array.isArray(body.apps) ? body.apps.filter((a: any) => typeof a === "string") : [];
  const osVersion = typeof body.osVersion === "string" ? body.osVersion : undefined;
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : undefined;

  await prisma.driver.update({
    where: { id: auth.driverId },
    data: { 
      thirdPartyApps: apps,
      osVersion,
      deviceId
    },
  });

  return NextResponse.json({ ok: true });
}
