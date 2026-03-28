export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const options = await prisma.vehicleOption.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    data: options.map((o) => ({ ...o, priceModifier: Number(o.priceModifier) })),
  });
}
