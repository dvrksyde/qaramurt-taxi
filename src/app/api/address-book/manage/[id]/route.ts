export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

type Ctx = { params: { id: string } };

// PATCH /api/address-book/manage/[id]  — update
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  const id = parseInt(params.id);
  const body = await req.json();
  const data: Record<string, any> = {};

  if (typeof body.name === "string")     data.name     = body.name.trim();
  if (typeof body.fullName === "string") data.fullName = body.fullName.trim() || null;
  if (body.latitude  !== undefined)      data.latitude  = parseFloat(body.latitude);
  if (body.longitude !== undefined)      data.longitude = parseFloat(body.longitude);
  if (body.isActive  !== undefined)      data.isActive  = Boolean(body.isActive);

  try {
    const item = await prisma.addressBook.update({ where: { id }, data });
    return NextResponse.json({ data: item });
  } catch {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }
}

// DELETE /api/address-book/manage/[id]  — delete
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  const id = parseInt(params.id);
  try {
    await prisma.addressBook.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
  }
}
