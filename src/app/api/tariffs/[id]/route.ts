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
    // Update standard fields via Prisma ORM
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

    // Update outOfCityKmRate via raw SQL (field not in Prisma types until db push)
    if (body.outOfCityKmRate !== undefined) {
      const rate = Number(body.outOfCityKmRate) || 0;
      await prisma.$executeRaw`UPDATE tariffs SET "outOfCityKmRate" = ${rate} WHERE id = ${id}`;
    }

    const outOfCityRows = await prisma.$queryRaw<Array<{ r: string }>>`
      SELECT "outOfCityKmRate" AS r FROM tariffs WHERE id = ${id} LIMIT 1
    `;

    return NextResponse.json({
      ...updated,
      basePrice: Number(updated.basePrice),
      pricePerKm: Number(updated.pricePerKm),
      pricePerMin: Number(updated.pricePerMin),
      minPrice: Number(updated.minPrice),
      extraWaitPrice: Number(updated.extraWaitPrice),
      outOfCityKmRate: Number(outOfCityRows[0]?.r ?? 0),
    });
  } catch (err) {
    console.error("PATCH /api/tariffs/[id] error:", err);
    return NextResponse.json({ error: "Failed to update tariff" }, { status: 500 });
  }
}
