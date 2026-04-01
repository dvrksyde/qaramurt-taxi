import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculatePrice, haversineKm, estimateMinutes } from "@/lib/pricing";
import { getGeozoneOverride } from "@/lib/geo";
import { checkPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// POST /api/orders/estimate
// Body: { pickupAddress, dropoffAddress, tariffId, pickupLat?, pickupLng?, dropoffLat?, dropoffLng? }
export async function POST(req: NextRequest) {
  const { allowed, response } = await checkPermission(["current_orders"]);
  if (!allowed) return response!;

  const body = await req.json();
  const { tariffId, pickupLat, pickupLng, dropoffLat, dropoffLng } = body;

  if (!tariffId) {
    return NextResponse.json({ error: "tariffId required" }, { status: 400 });
  }

  const tariff = await prisma.tariff.findUnique({ where: { id: parseInt(tariffId) } });
  if (!tariff) {
    return NextResponse.json({ error: "Tariff not found" }, { status: 404 });
  }

  // If GPS coords provided, use Haversine; otherwise return base price
  let distanceKm = 0;
  let estimatedMins = 0;
  let geozoneOverride: number | null = null;

  if (pickupLat && pickupLng && dropoffLat && dropoffLng) {
    distanceKm = haversineKm(
      parseFloat(pickupLat), parseFloat(pickupLng),
      parseFloat(dropoffLat), parseFloat(dropoffLng)
    );
    estimatedMins = estimateMinutes(distanceKm);

    // Check geozone price override
    geozoneOverride = await getGeozoneOverride(
      parseFloat(pickupLat), parseFloat(pickupLng),
      parseFloat(dropoffLat), parseFloat(dropoffLng),
      tariff.id
    ).catch(() => null);
  }

  const result = calculatePrice({
    distanceKm,
    estimatedMinutes: estimatedMins,
    tariff: {
      basePrice: Number(tariff.basePrice),
      pricePerKm: Number(tariff.pricePerKm),
      pricePerMin: Number(tariff.pricePerMin),
      minPrice: Number(tariff.minPrice),
      freeWaitMinutes: tariff.freeWaitMinutes,
      extraWaitPrice: Number(tariff.extraWaitPrice),
    },
    geozoneOverride,
  });

  return NextResponse.json({
    data: {
      estimatedPrice: Math.round(result.finalPrice),
      distanceKm: parseFloat(distanceKm.toFixed(2)),
      estimatedMinutes: Math.round(estimatedMins),
      breakdown: result,
    },
  });
}
