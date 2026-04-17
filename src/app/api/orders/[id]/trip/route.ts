import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderId = parseInt(id, 10);
  
  if (isNaN(orderId)) {
    return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
  }

  // Find all points for sessions of this order
  const points = await prisma.orderTripPoint.findMany({
    where: {
      tripSession: {
        orderId: orderId
      }
    },
    orderBy: {
      sequenceNumber: 'asc'
    },
    select: {
      lat: true,
      lng: true,
      speedKmh: true,
      capturedAt: true
    }
  });

  return NextResponse.json({ 
    data: points.map(p => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      speedKmh: p.speedKmh ? Number(p.speedKmh) : null,
      capturedAt: p.capturedAt
    }))
  });
}
