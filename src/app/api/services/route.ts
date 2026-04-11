export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export async function GET(_req: NextRequest) {
  const { allowed, response } = await checkPermission(["current_orders", "admin"]);
  if (!allowed) return response!;

  const services = await prisma.taxiService.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ data: services });
}
