import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> } // In Next.js 15, params is a Promise
) {
  try {
    const id = parseInt((await params).id, 10);
    const prisma = getPrisma();
    
    // Check if it's used in pricing
    const links = await prisma.geozonePrice.count({
      where: { OR: [{ geozoneFromId: id }, { geozoneToId: id }] }
    });
    
    if (links > 0) {
      return NextResponse.json({ error: "Cannot delete geozone linked to active pricing rules" }, { status: 400 });
    }

    await prisma.geozone.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/geozones/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete from DB" }, { status: 500 });
  }
}
