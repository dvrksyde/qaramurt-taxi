export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { reverseGeocode } from "@/lib/geocoder";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const address = await reverseGeocode(lat, lng);
  
  if (!address) {
    return NextResponse.json({ data: null });
  }

  return NextResponse.json({ data: { address } });
}
