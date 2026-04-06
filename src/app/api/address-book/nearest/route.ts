import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
    ;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  try {
    // Fetch all active landmarks
    // (In a high-scale app, we'd use PostGIS or a bounding box query here)
    const landmarks = await prisma.addressBook.findMany({
      where: { isActive: true }
    });

    let nearest = null;
    let minDistance = 0.1; // 100 meters limit

    for (const item of landmarks) {
      const dist = getDistanceFromLatLonInKm(lat, lng, Number(item.latitude), Number(item.longitude));
      if (dist < minDistance) {
        minDistance = dist;
        nearest = item;
      }
    }

    return NextResponse.json({ data: nearest });
  } catch (error) {
    console.error("Error finding nearest landmark:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
