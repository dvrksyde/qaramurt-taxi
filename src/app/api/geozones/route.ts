import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Convert WKT POLYGON((lng lat, ...)) to GeoJSON — no PostGIS required
function wktPolygonToGeoJSON(wkt: string): object | null {
  try {
    const match = wkt.match(/POLYGON\s*\(\((.*)\)\)/is);
    if (!match) return null;
    const coords = match[1].split(",").map((pair) => {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);
      return [lng, lat];
    });
    return { type: "Polygon", coordinates: [coords] };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const prisma = getPrisma();

    const geozones = await prisma.$queryRaw<
      Array<{ id: number; name: string; type: string; polygon: string; isActive: boolean; createdAt: Date }>
    >`
      SELECT id, name, type, polygon, "isActive", "createdAt"
      FROM geozones
      ORDER BY "createdAt" DESC
    `;

    return NextResponse.json(
      geozones.map((z) => ({
        id: z.id,
        name: z.name,
        type: z.type,
        isActive: z.isActive,
        createdAt: z.createdAt,
        geojson: wktPolygonToGeoJSON(z.polygon),
      }))
    );
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
        polygon,
      },
    });

    return NextResponse.json({
      id: zone.id,
      name: zone.name,
      type: zone.type,
      isActive: zone.isActive,
      createdAt: zone.createdAt,
      geojson: wktPolygonToGeoJSON(zone.polygon),
    });
  } catch (err) {
    console.error("POST /api/geozones error:", err);
    return NextResponse.json({ error: "Failed to create geozone" }, { status: 500 });
  }
}
