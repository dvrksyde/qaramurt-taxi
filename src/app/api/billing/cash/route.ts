export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

// GET /api/billing/cash?fromDate=&toDate=&operatorId=
export async function GET(req: NextRequest) {
  const { allowed, response, permissions, role, operatorId: currentOperatorId } =
    await checkPermission(["kassa_report_all", "kassa_operations"]);
  if (!allowed) return response!;

  const canSeeAll = role === "admin" || (permissions || []).includes("kassa_report_all");

  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get("fromDate") || new Date(Date.now() - 3 * 86400000).toISOString();
  const toDate   = searchParams.get("toDate")   || new Date().toISOString();
  const requestedOperatorId = searchParams.get("operatorId");
  const resolvedOperatorId = canSeeAll
    ? requestedOperatorId
    : currentOperatorId
      ? String(currentOperatorId)
      : null;

  const where: Record<string, unknown> = {
    createdAt: { gte: new Date(fromDate), lte: new Date(toDate) },
  };
  if (resolvedOperatorId) where.operatorId = parseInt(resolvedOperatorId);

  // Get all operators
  const operators = await prisma.operator.findMany({
    where: resolvedOperatorId ? { id: parseInt(resolvedOperatorId) } : { isActive: true },
    select: { id: true, name: true, cashBalance: true },
  });

  // Get transactions per operator
  const rows = await Promise.all(
    operators.map(async (op) => {
      const txWhere = { ...where, operatorId: op.id };
      const txs = await prisma.cashTransaction.findMany({ where: txWhere });

      // Выплаты диспетчера парку (инкассация)
      const payouts  = txs.filter((t) => t.type === "payout").reduce((s, t) => s + Number(t.amount), 0);
      // Пополнения (аванс от парка)
      const deposits = txs.filter((t) => t.type === "deposit").reduce((s, t) => s + Number(t.amount), 0);

      // Комиссии, которые собрала кассира (т.е. наличка, которая осела у оператора)
      const orderFees = txs.filter((t) => t.type === "order_fee").reduce((s, t) => s + Number(t.amount), 0);

      return {
        operatorId: op.id,
        operatorName: op.name,
        // Текущий остаток у оператора (из базы — актуален)
        currentCashBalance: Number(op.cashBalance),
        // За период: сколько собрал комиссий
        periodOrderFees: Math.round(orderFees),
        // За период: сколько сдал в кассу
        periodPayouts: Math.round(payouts),
        // За период: сколько получил авансом
        periodDeposits: Math.round(deposits),
        // Долг = накопленные комиссии минус сданные
        periodDebt: Math.round(orderFees - payouts + deposits),
      };
    })
  );

  return NextResponse.json({ data: rows });
}
