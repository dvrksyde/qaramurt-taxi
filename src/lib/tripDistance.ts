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
 * distance (≥ 10 m threshold per segment to filter GPS jitter), then
 * calculate the final price using the session's tariff.
 *
 * The 10 m threshold matches the app's distanceInterval: 15 m setting so
 * legitimate short segments (15–20 m) are not discarded.
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
        select: { lat: true, lng: true, sequenceNumber: true },
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
      const segKm = haversineKm(
        Number(prev.lat),
        Number(prev.lng),
        Number(curr.lat),
        Number(curr.lng)
      );
      // Ignore micro-jitter < 10 m (GPS noise at standstill)
      if (segKm >= 0.01) {
        totalKm += segKm;
      }
    }
  }
  // If pts.length < 2, totalKm stays 0 — the status route will
  // fall back to the client-reported distanceKm (sent as backup).

  // Round to 1 decimal (tenths of km) to match what the phone shows
  const distanceKm = Math.round(totalKm * 10) / 10;

  const tariffPerKm = Number(session.tariffPerKm ?? 80);
  const baseFare = Number(session.baseFare ?? BASE_FARE);
  // +10 ₸ correction — compensates for GPS rounding losses over the trip
  const finalPrice = roundTo5(baseFare + distanceKm * tariffPerKm) + 10;

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
