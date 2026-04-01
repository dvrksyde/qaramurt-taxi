export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export async function GET(_req: NextRequest) {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  const groups = await prisma.driverTariffGroup.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    data: groups.map((g) => ({ ...g, value: Number(g.value) })),
  });
}
