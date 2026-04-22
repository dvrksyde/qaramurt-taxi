export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/clients/[phone]/addresses
 * Returns top frequent pickup addresses for a client phone number.
 * Aggregates from completed orders, sorted by frequency (most used first).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const { phone } = await params;
  if (!phone || phone.length < 5) {
    return NextResponse.json({ data: [] });
  }

  // Fetch last 60 completed orders for this phone, non-empty pickup addresses
  const orders = await prisma.order.findMany({
    where: {
      phone: { contains: phone.replace(/\D/g, "").slice(-7) }, // match last 7 digits
      status: "completed",
      pickupAddress: { not: null },
    },
    select: {
      pickupAddress: true,
      pickupPoint: true,
    },
    orderBy: { completedAt: "desc" },
    take: 60,
  });

  // Count frequency of each unique address
  const freq: Record<string, { address: string; point: string | null; count: number }> = {};

  for (const o of orders) {
    const addr = o.pickupAddress?.trim();
    if (!addr || addr === "С бордюра") continue;

    if (freq[addr]) {
      freq[addr].count += 1;
    } else {
      freq[addr] = { address: addr, point: o.pickupPoint, count: 1 };
    }
  }

  // Sort by frequency, return top 5
  const top = Object.values(freq)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(({ address, point, count }) => ({ address, point, count }));

  return NextResponse.json({ data: top });
}
