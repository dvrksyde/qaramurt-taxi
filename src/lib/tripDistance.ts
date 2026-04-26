import { prisma } from "./prisma";

const BASE_FARE = 290;
const OUT_OF_CITY_MIN_RATE = 25; // ₸/мин вне города

function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type TripCalcResult = {
  sessionId: number;
  distanceKm: number;
  finalPrice: number;
  pointsUsed: number;
  cityKm: number;
  outOfCityKm: number;
  outOfCitySeconds: number;
};

type RawPoint = {
  lat: string;
  lng: string;
  sequence_number: number;
  captured_at: Date | null;
  speed_kmh: string | null;
  accuracy_m: string | null;
  is_out_of_city: boolean;
};

type RawSession = {
  id: number;
  tariff_per_km: string;
  out_of_city_km_rate: string;
  base_fare: string;
};

/**
 * Calculate trip distance and price with city/out-of-city zone awareness.
 *
 * Pricing formula:
 *   finalPrice = baseFare
 *              + cityKm       × tariffPerKm
 *              + outOfCityKm  × outOfCityKmRate
 *              + (outOfCitySeconds ÷ 60) × 25₸
 *
 * Segment zone = zone of its PREVIOUS point (isOutOfCity flag).
 */
export async function calculateSessionDistance(sessionId: number): Promise<TripCalcResult> {
  // Fetch session — try with new columns first, fall back if schema not updated
  let sessions: RawSession[] = [];
  try {
    sessions = await prisma.$queryRaw<RawSession[]>`
      SELECT id,
             "tariffPerKm"       AS tariff_per_km,
             "outOfCityKmRate"   AS out_of_city_km_rate,
             "baseFare"          AS base_fare
      FROM order_trip_sessions
      WHERE id = ${sessionId}
      LIMIT 1
    `;
  } catch {
    // outOfCityKmRate column doesn't exist yet — fetch without it
    const fallback = await prisma.$queryRaw<Array<{ id: number; tariff_per_km: string; base_fare: string }>>`
      SELECT id, "tariffPerKm" AS tariff_per_km, "baseFare" AS base_fare
      FROM order_trip_sessions WHERE id = ${sessionId} LIMIT 1
    `;
    sessions = fallback.map((r) => ({ ...r, out_of_city_km_rate: "0" }));
  }

  if (!sessions.length) throw new Error(`Trip session ${sessionId} not found`);
  const session = sessions[0];

  // Fetch points — try with isOutOfCity first, fall back if column not yet added
  let pts: RawPoint[] = [];
  try {
    pts = await prisma.$queryRaw<RawPoint[]>`
      SELECT lat, lng,
             "sequenceNumber" AS sequence_number,
             "capturedAt"     AS captured_at,
             "speedKmh"       AS speed_kmh,
             "accuracyM"      AS accuracy_m,
             "isOutOfCity"    AS is_out_of_city
      FROM order_trip_points
      WHERE "tripSessionId" = ${sessionId}
      ORDER BY "sequenceNumber" ASC
    `;
  } catch {
    // isOutOfCity column doesn't exist yet — fetch without it, treat all as city
    const fallback = await prisma.$queryRaw<Array<Omit<RawPoint, "is_out_of_city">>>`
      SELECT lat, lng,
             "sequenceNumber" AS sequence_number,
             "capturedAt"     AS captured_at,
             "speedKmh"       AS speed_kmh,
             "accuracyM"      AS accuracy_m
      FROM order_trip_points
      WHERE "tripSessionId" = ${sessionId}
      ORDER BY "sequenceNumber" ASC
    `;
    pts = fallback.map((p) => ({ ...p, is_out_of_city: false }));
  }

  let cityKm = 0;
  let outOfCityKm = 0;
  let outOfCitySeconds = 0;

  if (pts.length >= 2) {
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];

      const accuracy = Number(curr.accuracy_m ?? 0);
      if (accuracy > 100 && accuracy > 0) continue;

      const segKm = haversineKm(
        Number(prev.lat), Number(prev.lng),
        Number(curr.lat), Number(curr.lng)
      );
      if (segKm < 0.010) continue; // raised from 5m to 10m to filter GPS jitter

      // Skip if both endpoints indicate stationary (speed < 2 km/h) and segment < 15m
      const prevSpeed = prev.speed_kmh !== null ? Number(prev.speed_kmh) : null;
      const currSpeed = curr.speed_kmh !== null ? Number(curr.speed_kmh) : null;
      const bothStopped = (prevSpeed !== null && prevSpeed < 2) && (currSpeed !== null && currSpeed < 2);
      if (bothStopped && segKm < 0.015) continue;

      const prevTime = prev.captured_at ? new Date(prev.captured_at).getTime() : 0;
      const currTime = curr.captured_at ? new Date(curr.captured_at).getTime() : 0;
      const gapSec = currTime && prevTime ? (currTime - prevTime) / 1000 : 0;

      // Sanity cap: physically impossible at any car speed (max ~200 km/h)
      const maxPossibleKm = gapSec > 0 ? 200 * (gapSec / 3600) : 2;
      if (segKm > maxPossibleKm) continue; // GPS jump

      // Old short-gap jump filter (kept as additional safety)
      if (gapSec > 0 && segKm > 2 && gapSec < 20) continue;

      const segIsOutOfCity = prev.is_out_of_city ?? false;
      let effectiveKm = segKm;

      if (gapSec > 20) {
        const speedKmh = prev.speed_kmh !== null ? Number(prev.speed_kmh) : null;
        if (speedKmh !== null && speedKmh > 5) {
          const interpolated = speedKmh * (gapSec / 3600);
          if (interpolated > segKm) effectiveKm = interpolated;
        } else if (speedKmh === null && segKm > 0.1) {
          // No speed from Android but distance is physically plausible
          effectiveKm = segKm;
        }
      }

      if (segIsOutOfCity) {
        outOfCityKm += effectiveKm;
        if (gapSec > 0) outOfCitySeconds += gapSec;
      } else {
        cityKm += effectiveKm;
      }
    }
  }

  cityKm      = Math.ceil(cityKm      * 10) / 10;
  outOfCityKm = Math.ceil(outOfCityKm * 10) / 10;
  const distanceKm = cityKm + outOfCityKm;

  const tariffPerKm   = Number(session.tariff_per_km     ?? 80);
  const outOfCityRate = Number(session.out_of_city_km_rate ?? 0);
  const baseFare      = Number(session.base_fare          ?? BASE_FARE);
  const outOfCityTimeFee = Math.floor(outOfCitySeconds / 60) * OUT_OF_CITY_MIN_RATE;

  const finalPrice = roundTo5(
    baseFare
    + cityKm      * tariffPerKm
    + outOfCityKm * (outOfCityRate || tariffPerKm)
    + outOfCityTimeFee
  );

  return { sessionId, distanceKm, finalPrice, pointsUsed: pts.length, cityKm, outOfCityKm, outOfCitySeconds };
}

export async function completeSession(
  sessionId: number,
  distanceKm: number,
  finalPrice: number,
  outOfCityKm = 0,
  outOfCitySeconds = 0,
): Promise<void> {
  try {
    // Try with new columns (after db:push)
    await prisma.$executeRaw`
      UPDATE order_trip_sessions
      SET status             = 'completed',
          "finalDistanceKm"  = ${distanceKm},
          "finalPrice"       = ${finalPrice},
          "outOfCityKm"      = ${outOfCityKm},
          "outOfCitySeconds" = ${outOfCitySeconds},
          "completedAt"      = NOW()
      WHERE id = ${sessionId}
    `;
  } catch {
    // New columns don't exist yet — fall back to minimal update
    await prisma.$executeRaw`
      UPDATE order_trip_sessions
      SET status            = 'completed',
          "finalDistanceKm" = ${distanceKm},
          "finalPrice"      = ${finalPrice},
          "completedAt"     = NOW()
      WHERE id = ${sessionId}
    `;
  }
}
