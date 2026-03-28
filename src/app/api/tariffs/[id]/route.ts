export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const id = parseInt((await params).id, 10);
    const body = await req.json();

    const prisma = getPrisma();
    const updated = await prisma.tariff.update({
      where: { id },
      data: {
        basePrice: body.basePrice,
        pricePerKm: body.pricePerKm,
        pricePerMin: body.pricePerMin,
        minPrice: body.minPrice,
        freeWaitMinutes: body.freeWaitMinutes,
        extraWaitPrice: body.extraWaitPrice,
      },
    });

    return NextResponse.json({
      ...updated,
      basePrice: Number(updated.basePrice),
      pricePerKm: Number(updated.pricePerKm),
      pricePerMin: Number(updated.pricePerMin),
      minPrice: Number(updated.minPrice),
      extraWaitPrice: Number(updated.extraWaitPrice),
    });
  } catch (err) {
    console.error("PATCH /api/tariffs/[id] error:", err);
    return NextResponse.json({ error: "Failed to update tariff" }, { status: 500 });
  }
}
