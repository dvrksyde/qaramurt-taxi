export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findNearbyDrivers } from "@/lib/geo";

// GET /api/drivers/nearby?lat=&lng=&radius=&classId=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") || "0");
  const lng = parseFloat(searchParams.get("lng") || "0");
  const radius = parseFloat(searchParams.get("radius") || "10");
  const classId = searchParams.get("classId") ? parseInt(searchParams.get("classId")!) : undefined;

  if (!lat || !lng) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  const drivers = await findNearbyDrivers(lat, lng, radius, classId);
  return NextResponse.json({ data: drivers });
}
