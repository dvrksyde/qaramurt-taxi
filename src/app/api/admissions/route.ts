export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const { allowed, response } = await checkPermission(["vehicle_admissions"]);
  if (!allowed) return response!;

  const docs = await prisma.driverDocument.findMany({
    include: {
      driver: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: docs });
}
