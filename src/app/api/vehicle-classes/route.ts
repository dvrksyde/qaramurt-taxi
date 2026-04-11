export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

// GET /api/vehicle-classes — grouped by group
export async function GET(_req: NextRequest) {
  const { allowed, response } = await checkPermission([
    "current_orders",
    "add_drivers",
    "edit_drivers",
    "admin",
  ]);
  if (!allowed) return response!;

  const groups = await prisma.vehicleClassGroup.findMany({
    include: {
      classes: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ data: groups });
}
