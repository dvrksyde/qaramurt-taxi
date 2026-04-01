export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";

// POST /api/operators/heartbeat — called periodically to keep lastSeenAt fresh
export async function POST() {
  const { allowed, response, operatorId } = await requireAuth();
  if (!allowed) return response!;
  if (!operatorId) return NextResponse.json({ error: "No operator ID" }, { status: 400 });

  await prisma.operator.update({
    where: { id: operatorId },
    data: { lastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
