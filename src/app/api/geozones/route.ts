import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prisma = getPrisma();
    
    // Use raw query to convert PostGIS WKT to GeoJSON for the client
    const geozones = await prisma.$queryRaw`
      SELECT id, name, type, ST_AsGeoJSON(polygon)::jsonb as geojson, "isActive", "createdAt"
      FROM geozones
      ORDER BY "createdAt" DESC
    `;
    
    return NextResponse.json(geozones);
  } catch (err) {
    console.error("GET /api/geozones error:", err);
    return NextResponse.json({ error: "Failed to load geozones" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const { name, type, polygon } = data;

    if (!name || !polygon) {
      return NextResponse.json({ error: "Name and polygon are required" }, { status: 400 });
    }

    const prisma = getPrisma();
    const zone = await prisma.geozone.create({
      data: {
        name,
        type: type || "zone",
        polygon, // Stored as WKT string
      },
    });

    return NextResponse.json(zone);
  } catch (err) {
    console.error("POST /api/geozones error:", err);
    return NextResponse.json({ error: "Failed to create geozone" }, { status: 500 });
  }
}
