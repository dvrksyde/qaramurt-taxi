import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function wktPolygonToGeoJSON(wkt: string): object | null {
  try {
    const match = wkt.match(/POLYGON\s*\(\(([\s\S]*)\)\)/i);
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = parseInt((await params).id, 10);
    const prisma = getPrisma();

    const rows = await prisma.$queryRaw<
      Array<{ id: number; name: string; type: string; polygon: string; isActive: boolean; createdAt: Date }>
    >`
      SELECT id, name, "type", polygon, "isActive", "createdAt"
      FROM geozones WHERE id = ${id} LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const z = rows[0];
    return NextResponse.json({
      id: z.id,
      name: z.name,
      type: z.type,
      isActive: z.isActive,
      createdAt: z.createdAt,
      geojson: wktPolygonToGeoJSON(z.polygon),
    });
  } catch (err) {
    console.error("GET /api/geozones/[id] error:", err);
    return NextResponse.json({ error: "Failed to load geozone" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = parseInt((await params).id, 10);
    const body = await req.json();
    const prisma = getPrisma();

    const updated = await prisma.geozone.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.type !== undefined && { type: body.type }),
        ...(body.polygon !== undefined && { polygon: body.polygon }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      type: updated.type,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      geojson: wktPolygonToGeoJSON(updated.polygon),
    });
  } catch (err) {
    console.error("PATCH /api/geozones/[id] error:", err);
    return NextResponse.json({ error: "Failed to update geozone" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = parseInt((await params).id, 10);
    const prisma = getPrisma();

    // Check if it's used in pricing
    const links = await prisma.geozonePrice.count({
      where: { OR: [{ geozoneFromId: id }, { geozoneToId: id }] },
    });

    if (links > 0) {
      return NextResponse.json(
        { error: "Cannot delete geozone linked to active pricing rules" },
        { status: 400 }
      );
    }

    await prisma.geozone.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/geozones/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete geozone" }, { status: 500 });
  }
}
