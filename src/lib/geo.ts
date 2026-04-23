import { prisma } from "./prisma";

/**
 * Find nearest free drivers to a coordinate using PostGIS ST_DWithin.
 * Returns drivers ordered by distance (closest first).
 */
export async function findNearbyDrivers(
  lat: number,
  lng: number,
  radiusKm = 10,
  classId?: number
): Promise<Array<{ id: number; callsign: string | null; distanceKm: number }>> {
  const radiusMeters = radiusKm * 1000;

  const results = await prisma.$queryRaw<
    Array<{ id: number; callsign: string | null; distance_m: number }>
  >`
    SELECT 
      d.id,
      d.callsign,
      ST_Distance(
        d."currentLocation"::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      ) AS distance_m
    FROM drivers d
    WHERE 
      d.status = 'free'
      AND d."isActive" = true
      AND d."currentLocation" IS NOT NULL
      AND ST_DWithin(
        d."currentLocation"::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ${radiusMeters}
      )
    ORDER BY distance_m ASC
    LIMIT 20
  `;

  return results.map((r) => ({
    id: r.id,
    callsign: r.callsign,
    distanceKm: r.distance_m / 1000,
  }));
}

/**
 * Get geozone price override for a trip between two coordinates.
 * Checks if pickup/dropoff points fall within registered geozones.
 */
export async function getGeozoneOverride(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
  tariffId: number
): Promise<number | null> {
  const result = await prisma.$queryRaw<Array<{ priceOverride: number }>>`
    SELECT gp."priceOverride" as "priceOverride"
    FROM geozone_prices gp
    JOIN geozones gz_from ON gp."geozoneFromId" = gz_from.id
    JOIN geozones gz_to   ON gp."geozoneToId"   = gz_to.id
    WHERE
      gp."tariffId" = ${tariffId}
      AND gp."isActive" = true
      AND ST_Contains(gz_from.polygon, ST_SetSRID(ST_MakePoint(${pickupLng}, ${pickupLat}), 4326))
      AND ST_Contains(gz_to.polygon,   ST_SetSRID(ST_MakePoint(${dropoffLng}, ${dropoffLat}), 4326))
    LIMIT 1
  `;

  return result[0]?.priceOverride ?? null;
}

/**
 * Check if a point falls inside any registered geozone.
 */
export async function getGeozoneForPoint(
  lat: number,
  lng: number
): Promise<{ id: number; name: string } | null> {
  const result = await prisma.$queryRaw<Array<{ id: number; name: string }>>`
    SELECT id, name
    FROM geozones
    WHERE 
      "isActive" = true
      AND ST_Contains(polygon, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
    LIMIT 1
  `;

  return result[0] ?? null;
}

/**
 * Update driver GPS location (raw SQL to preserve PostGIS type)
 */
export async function updateDriverLocation(
  driverId: number,
  lat: number,
  lng: number
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE drivers
    SET "currentLocation" = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
    WHERE id = ${driverId}
  `;
}
