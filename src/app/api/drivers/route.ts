export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/drivers
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  const where: Record<string, unknown> = { isActive: true };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { lastName:  { contains: search, mode: "insensitive" } },
      { firstName: { contains: search, mode: "insensitive" } },
      { phone:     { contains: search } },
      { callsign:  { contains: search, mode: "insensitive" } },
    ];
  }

  const drivers = await prisma.driver.findMany({
    where,
    include: {
      tariffGroup: { select: { name: true, type: true } },
      vehicles: { select: { id: true, plate: true, make: true, model: true, color: true } },
    },
    orderBy: [{ status: "asc" }, { lastName: "asc" }],
  });

  // Serialize: strip binary location field, convert to {lat, lng}
  const serialized = drivers.map((d) => ({
    ...d,
    balance: Number(d.balance),
    maxCredit: Number(d.maxCredit),
    rating: Number(d.rating),
    currentLocation: null, // PostGIS geometry not JSON-serializable; use dedicated endpoint
  }));

  return NextResponse.json({ data: serialized });
}

// POST /api/drivers — create driver
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { lastName, firstName, middleName, phone, login, password, callsign, tariffGroupId, maxCredit, comment } = body;

  if (!lastName || !firstName || !phone || !login || !password) {
    return NextResponse.json({ error: "Заполните обязательные поля" }, { status: 400 });
  }

  // Check uniqueness
  const exists = await prisma.driver.findFirst({
    where: { OR: [{ phone }, { login }] },
  });
  if (exists) {
    return NextResponse.json({ error: "Телефон или логин уже используется" }, { status: 409 });
  }

  // In production, use bcrypt. For demo, store plain hash marker.
  const passwordHash = password; // TODO: await bcrypt.hash(password, 10)

  const driver = await prisma.driver.create({
    data: {
      lastName,
      firstName,
      middleName: middleName || null,
      phone,
      login,
      passwordHash,
      callsign: callsign || null,
      tariffGroupId: tariffGroupId ? parseInt(tariffGroupId) : null,
      maxCredit: maxCredit ? parseFloat(maxCredit) : 0,
      comment: comment || null,
      status: "offline",
    },
  });

  return NextResponse.json({ data: driver }, { status: 201 });
}
