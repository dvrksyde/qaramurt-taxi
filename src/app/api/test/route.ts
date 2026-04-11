import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const d = await prisma.driver.findUnique({
    where: { id: 3 },
    include: { vehicles: { include: { classes: true } } }
  });
  return NextResponse.json({ data: d });
}
