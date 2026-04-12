export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

export async function GET(_req: NextRequest) {
  const { allowed, response } = await checkPermission(["vehicle_admissions"]);
  if (!allowed) return response!;

  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    include: {
      driver: { select: { id: true, firstName: true, lastName: true } },
      classes: { include: { class: { include: { group: true } } } },
      services: { include: { service: true } },
    },
    orderBy: { id: "desc" },
  });

  return NextResponse.json({ data: vehicles });
}

export async function POST(req: NextRequest) {
  const { allowed, response } = await checkPermission(["vehicle_admissions"]);
  if (!allowed) return response!;

  const body = await req.json();
  const { plate, make, model, color, year, ownershipType, driverId, classIds, serviceIds } = body;

  if (!plate || !make || !model) {
    return NextResponse.json({ error: "Гос. номер, марка и модель обязательны" }, { status: 400 });
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      plate: plate.toUpperCase(),
      make,
      model,
      color: color || "",
      year: year || null,
      ownershipType: ownershipType || "driver",
      driverId: driverId ? parseInt(driverId) : null,
      classes: classIds?.length
        ? { create: classIds.map((cId: number) => ({ classId: cId })) }
        : undefined,
      services: serviceIds?.length
        ? { create: serviceIds.map((sId: number) => ({ serviceId: sId })) }
        : undefined,
    },
  });

  return NextResponse.json({ data: vehicle }, { status: 201 });
}
