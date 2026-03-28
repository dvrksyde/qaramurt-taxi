/**
 * Pricing Engine
 * Calculates estimated trip cost based on:
 * - Distance (km)
 * - Tariff rules (base, per km, per min)
 * - Geozone price overrides
 */

export interface TariffRules {
  basePrice: number;
  pricePerKm: number;
  pricePerMin: number;
  minPrice: number;
  freeWaitMinutes: number;
  extraWaitPrice: number;
}

export interface PriceEstimateInput {
  distanceKm: number;
  estimatedMinutes?: number;
  tariff: TariffRules;
  geozoneOverride?: number | null;
}

export interface PriceEstimateResult {
  basePrice: number;
  distanceCharge: number;
  timeCharge: number;
  total: number;
  finalPrice: number;
  appliedOverride: boolean;
}

/**
 * Calculates trip price.
 * If geozoneOverride is set (from geozone_prices), it replaces the calculated total.
 */
export function calculatePrice(input: PriceEstimateInput): PriceEstimateResult {
  const { distanceKm, estimatedMinutes = 0, tariff, geozoneOverride } = input;

  const distanceCharge = distanceKm * tariff.pricePerKm;
  const timeCharge = estimatedMinutes * tariff.pricePerMin;
  const raw = tariff.basePrice + distanceCharge + timeCharge;
  const calculated = Math.max(raw, tariff.minPrice);

  if (geozoneOverride !== null && geozoneOverride !== undefined) {
    return {
      basePrice: tariff.basePrice,
      distanceCharge,
      timeCharge,
      total: calculated,
      finalPrice: geozoneOverride,
      appliedOverride: true,
    };
  }

  return {
    basePrice: tariff.basePrice,
    distanceCharge,
    timeCharge,
    total: calculated,
    finalPrice: calculated,
    appliedOverride: false,
  };
}

/**
 * Haversine formula — great-circle distance between two GPS coordinates
 */
export function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Estimate driving time from distance.
 * Uses average urban speed of 30 km/h.
 */
export function estimateMinutes(distanceKm: number, avgSpeedKmh = 30): number {
  return (distanceKm / avgSpeedKmh) * 60;
}
