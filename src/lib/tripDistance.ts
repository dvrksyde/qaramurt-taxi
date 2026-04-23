import { prisma } from "./prisma";

const BASE_FARE = 290;

function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

/**
 * Haversine distance between two WGS-84 coordinates (in km).
 */
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
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
};

/**
 * Fetch all GPS points for a trip session, compute cumulative Haversine
 * distance (≥ 5 m threshold per segment to filter GPS jitter), then
 * calculate the final price using the session's tariff.
 *
 * Gap interpolation: if two consecutive points are more than 20 seconds apart
 * AND speed data is available, we interpolate the missing distance using
 * speed × time. This compensates for phones that drop GPS in background.
 *
 * If the session has fewer than 2 points the function returns distanceKm = 0
 * and the caller (status route) falls back to the client-reported values.
 */
export async function calculateSessionDistance(
  sessionId: number
): Promise<TripCalcResult> {
  const session = await prisma.orderTripSession.findUnique({
    where: { id: sessionId },
    include: {
      points: {
        orderBy: { sequenceNumber: "asc" },
        select: { lat: true, lng: true, sequenceNumber: true, capturedAt: true, speedKmh: true, accuracyM: true },
      },
    },
  });

  if (!session) {
    throw new Error(`Trip session ${sessionId} not found`);
  }

  const pts = session.points;
  let totalKm = 0;

  if (pts.length >= 2) {
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];

      // Skip points with very poor accuracy (> 50m) — they add noise
      const accuracy = Number(curr.accuracyM ?? 0);
      if (accuracy > 50 && accuracy > 0) continue;

      const segKm = haversineKm(
        Number(prev.lat),
        Number(prev.lng),
        Number(curr.lat),
        Number(curr.lng)
      );

      // Ignore micro-jitter < 5 m (GPS noise at standstill)
      if (segKm < 0.005) continue;

      // Sanity cap: single segment > 2 km in < 20 sec = GPS jump, skip it
      const prevTime = prev.capturedAt ? new Date(prev.capturedAt).getTime() : 0;
      const currTime = curr.capturedAt ? new Date(curr.capturedAt).getTime() : 0;
      const gapSec = currTime && prevTime ? (currTime - prevTime) / 1000 : 0;

      if (gapSec > 0 && segKm > 2 && gapSec < 20) {
        // Likely a GPS jump — skip
        continue;
      }

      // Gap interpolation: GPS dropped for > 20 sec while driving
      // Use speed from the PREVIOUS point to estimate missed distance
      if (gapSec > 20 && prev.speedKmh !== null && Number(prev.speedKmh) > 5) {
        const speedKmh = Number(prev.speedKmh);
        const gapHours = gapSec / 3600;
        const interpolatedKm = speedKmh * gapHours;
        // Use interpolated only if it's more than what haversine shows (GPS jumped)
        if (interpolatedKm > segKm) {
          totalKm += interpolatedKm;
          continue;
        }
      }

      totalKm += segKm;
    }
  }
  // If pts.length < 2, totalKm stays 0 — the status route will
  // fall back to the client-reported distanceKm (sent as backup).

  // Round UP to nearest 0.1 km — never shortchange the driver
  const distanceKm = Math.ceil(totalKm * 10) / 10;

  const tariffPerKm = Number(session.tariffPerKm ?? 80);
  const baseFare = Number(session.baseFare ?? BASE_FARE);
  const finalPrice = roundTo5(baseFare + distanceKm * tariffPerKm);

  return {
    sessionId,
    distanceKm,
    finalPrice,
    pointsUsed: pts.length,
  };
}

/**
 * Close the trip session and persist finalDistanceKm / finalPrice.
 */
export async function completeSession(
  sessionId: number,
  distanceKm: number,
  finalPrice: number
): Promise<void> {
  await prisma.orderTripSession.update({
    where: { id: sessionId },
    data: {
      status: "completed",
      finalDistanceKm: distanceKm,
      finalPrice: finalPrice,
      completedAt: new Date(),
    },
  });
}
