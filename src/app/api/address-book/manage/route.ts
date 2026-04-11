export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

// GET /api/address-book/manage  — list all with pagination
export async function GET(req: NextRequest) {
  const { allowed, response } = await checkPermission(["admin", "current_orders"]);
  if (!allowed) return response!;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const skip = parseInt(searchParams.get("skip") || "0");
  const take = parseInt(searchParams.get("take") || "50");

  const where = q.length >= 1
    ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { fullName: { contains: q, mode: "insensitive" as const } }] }
    : {};

  const [items, total] = await Promise.all([
    prisma.addressBook.findMany({ where, skip, take, orderBy: { name: "asc" } }),
    prisma.addressBook.count({ where }),
  ]);

  return NextResponse.json({ data: items, total });
}

// POST /api/address-book/manage  — create new
export async function POST(req: NextRequest) {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : null;
  const lat = parseFloat(body.latitude);
  const lng = parseFloat(body.longitude);

  if (!name || isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "name, latitude и longitude обязательны" }, { status: 400 });
  }

  const item = await prisma.addressBook.create({
    data: { name, fullName: fullName || null, latitude: lat, longitude: lng, isActive: true },
  });

  return NextResponse.json({ data: item }, { status: 201 });
}
