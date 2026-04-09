export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const groups = await prisma.driverTariffGroup.findMany({
    orderBy: { id: "asc" },
  });
  return NextResponse.json({ data: groups });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, value, description, type } = body;

  if (!name || value === undefined) {
    return NextResponse.json({ error: "Название и значение (процент) обязательны" }, { status: 400 });
  }

  const group = await prisma.driverTariffGroup.create({
    data: {
      name,
      value: Number(value),
      description: description || null,
      type: type || "commission",
      isActive: true,
    },
  });

  return NextResponse.json({ data: group });
}
