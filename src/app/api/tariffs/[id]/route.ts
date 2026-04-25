export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  try {
    const id = parseInt((await params).id, 10);
    const body = await req.json();

    const prisma = getPrisma();
    const updated = await prisma.tariff.update({
      where: { id },
      data: {
        basePrice: body.basePrice,
        pricePerKm: body.pricePerKm,
        outOfCityKmRate: body.outOfCityKmRate ?? 0,
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
