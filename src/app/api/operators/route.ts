export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const operators = await prisma.operator.findMany({
    where: { isActive: true },
    select: { id: true, login: true, name: true, role: true, cashBalance: true, advanceBalance: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    data: operators.map((o) => ({
      ...o,
      cashBalance: Number(o.cashBalance),
      advanceBalance: Number(o.advanceBalance),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, login, password, role } = body;

  if (!name || !login || !password) {
    return NextResponse.json({ error: "Заполните все поля" }, { status: 400 });
  }

  const op = await prisma.operator.create({
    data: { name, login, passwordHash: password, role: role || "operator" },
  });

  return NextResponse.json({ data: op }, { status: 201 });
}
