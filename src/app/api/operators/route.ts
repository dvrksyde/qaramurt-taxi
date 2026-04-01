export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";
import { hashPassword } from "@/lib/passwords";

function serializeOperator(operator: any) {
  const { passwordHash: _passwordHash, ...safeOperator } = operator;
  return safeOperator;
}

export async function GET(_req: NextRequest) {
  const { allowed, response, permissions, role, operatorId } = await checkPermission([
    "admin",
    "journal_own",
    "journal_all",
    "operator_stats",
    "topup_operators",
    "kassa_report_all",
    "kassa_operations",
  ]);
  if (!allowed) return response!;

  const isAdmin = role === "admin";
  const canSeeAll =
    isAdmin ||
    (permissions || []).some((permission) =>
      ["journal_all", "operator_stats", "topup_operators", "kassa_report_all"].includes(permission)
    );

  const operators = await prisma.operator.findMany({
    where: canSeeAll ? undefined : { id: operatorId },
    select: {
      id: true, login: true, name: true, role: true,
      cashBalance: true, advanceBalance: true, isActive: true,
      permissions: true, lastSeenAt: true,
    },
    orderBy: { name: "asc" },
  });

  const now = Date.now();
  const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

  return NextResponse.json({
    data: operators.map((o) => ({
      ...o,
      cashBalance: Number(o.cashBalance),
      advanceBalance: Number(o.advanceBalance),
      isOnline: o.lastSeenAt ? (now - new Date(o.lastSeenAt).getTime()) < ONLINE_THRESHOLD_MS : false,
    })),
  });
}

export async function POST(req: NextRequest) {
  // Only admins can create operators
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  const body = await req.json();
  const { name, login, password, role, permissions } = body;

  if (!name || !login || !password) {
    return NextResponse.json({ error: "Заполните все поля" }, { status: 400 });
  }

  const op = await prisma.operator.create({
    data: {
      name,
      login,
      passwordHash: await hashPassword(password),
      role: role || "operator",
      permissions: permissions || [],
    },
  });

  return NextResponse.json({ data: serializeOperator(op) }, { status: 201 });
}

