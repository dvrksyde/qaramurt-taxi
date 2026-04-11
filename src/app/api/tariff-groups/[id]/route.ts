export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const { name, value, description, isActive } = body;

  const group = await prisma.driverTariffGroup.update({
    where: { id: parseInt(id) },
    data: {
      ...(name && { name }),
      ...(value !== undefined && { value: Number(value) }),
      ...(description !== undefined && { description }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  return NextResponse.json({ data: group });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  
  // Update drivers fallback to prevent orphaned constraint
  await prisma.driver.updateMany({
    where: { tariffGroupId: parseInt(id) },
    data: { tariffGroupId: null },
  });

  const deleted = await prisma.driverTariffGroup.delete({
    where: { id: parseInt(id) },
  });

  return NextResponse.json({ data: deleted });
}
