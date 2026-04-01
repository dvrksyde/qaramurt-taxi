import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";
import { hashPassword } from "@/lib/passwords";

function serializeOperator(operator: any) {
  const { passwordHash: _passwordHash, ...safeOperator } = operator;
  return safeOperator;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  const resolvedParams = await Promise.resolve(params);
  const id = parseInt(resolvedParams.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const body = await req.json();
  const { name, login, password, role, permissions } = body;

  try {
    const data: any = { name, login, role };
    // Only update password if provided
    if (password) {
      data.passwordHash = await hashPassword(password);
    }
    if (permissions !== undefined) {
      data.permissions = permissions;
    }

    const op = await prisma.operator.update({
      where: { id },
      data,
    });

    return NextResponse.json({ data: serializeOperator(op) });
  } catch (err) {
    console.error("Error updating operator", err);
    return NextResponse.json({ error: "Failed to update operator" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  const resolvedParams = await Promise.resolve(params);
  const id = parseInt(resolvedParams.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    const { isActive } = await req.json();
    const op = await prisma.operator.update({
      where: { id },
      data: { isActive },
    });
    return NextResponse.json({ data: serializeOperator(op) });
  } catch (err) {
    console.error("Error toggling operator status", err);
    return NextResponse.json({ error: "Failed to toggle operator status" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  const resolvedParams = await Promise.resolve(params);
  const id = parseInt(resolvedParams.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    await prisma.operator.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Error deleting operator", err);
    // Return friendly error if foreign key constraint fails
    if (err?.code === 'P2003') {
      return NextResponse.json({ error: "Невозможно удалить оператора, так как к нему привязаны заказы или другие данные. Вы можете просто отключить его." }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to delete operator" }, { status: 500 });
  }
}
