import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET: History of transactions
export async function GET(_req: NextRequest, { params }: Params) {
  const { allowed, response } = await checkPermission(["edit_drivers"]);
  if (!allowed) return response!;

  const { id } = await params;
  const transactions = await prisma.cashTransaction.findMany({
    where: { driverId: parseInt(id) },
    orderBy: { createdAt: "desc" },
    include: { operator: { select: { name: true } } },
    take: 50,
  });

  return NextResponse.json({ data: transactions });
}

// POST: New manual transaction
export async function POST(req: NextRequest, { params }: Params) {
  const { allowed, response, operatorId } = await checkPermission(["edit_drivers"]);
  if (!allowed) return response!;

  const { id } = await params;
  const driverId = parseInt(id);
  const body = await req.json();
  const { amount, type, description } = body;

  if (!amount || isNaN(Number(amount))) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Record transaction
      const transaction = await tx.cashTransaction.create({
        data: {
          driverId,
          operatorId: operatorId || 1,
          amount: Number(amount),
          type, // deposit, payout, penalty, bonus
          description,
        },
      });

      // 2. Update driver balance
      // If deposit/bonus -> increment, If payout/penalty/order_fee -> decrement
      // Actually CashTransaction.amount is usually positive, and we decide direction by type
      const isIncrement = ["deposit", "bonus"].includes(type);
      
      await tx.driver.update({
        where: { id: driverId },
        data: {
          balance: {
            [isIncrement ? "increment" : "decrement"]: Number(amount)
          }
        }
      });

      return transaction;
    });

    return NextResponse.json({ data: result });
  } catch (error: any) {
    console.error("Transaction error:", error);
    return NextResponse.json({ error: "Ошибка при выполнении транзакции" }, { status: 500 });
  }
}
