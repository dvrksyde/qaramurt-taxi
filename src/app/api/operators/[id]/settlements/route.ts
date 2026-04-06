import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

// GET /api/operators/[id]/settlements
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { allowed, response } = await checkPermission(["operators_view"]);
  if (!allowed) return response!;

  const operatorId = parseInt(id);

  try {
    const settlements = await prisma.operatorSettlement.findMany({
      where: { operatorId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ data: settlements });
  } catch (error) {
    console.error("Error fetching settlements:", error);
    return NextResponse.json({ error: "Failed to fetch settlements" }, { status: 500 });
  }
}

// POST /api/operators/[id]/settlements
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { allowed, response } = await checkPermission(["operators_edit"]);
  if (!allowed) return response!;

  const operatorId = parseInt(id);
  const body = await req.json();
  const { amount, type, description } = body;

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  try {
    const settlement = await (prisma as any).operatorSettlement.create({
      data: {
        operatorId,
        amount: Number(amount),
        type: type || "salary",
        description,
      },
    });

    return NextResponse.json({ data: settlement });
  } catch (error: any) {
    console.error("Error creating settlement:", error);
    const keys = Object.keys(prisma).filter(k => !k.startsWith("_"));
    return NextResponse.json({ 
      error: `Failed to create settlement. Error: ${error.message}. Models found: ${keys.join(", ")}` 
    }, { status: 500 });
  }
}
