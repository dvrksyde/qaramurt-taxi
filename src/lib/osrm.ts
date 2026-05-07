/**
 * OSRM Map Matching client.
 *
 * Sends GPS points to a local OSRM server and returns the total
 * road-network distance in km. Returns null if OSRM is unavailable
 * or the match fails — caller must fall back to haversine.
 *
 * Points are chunked at 99 per request (OSRM default limit is 100).
 * Timestamps must be strictly monotonically increasing; if they are not
 * (e.g. same second), we omit them so OSRM resolves the match geometrically.
 */

const OSRM_URL = process.env.OSRM_URL;
const CHUNK_SIZE = 99;
const FETCH_TIMEOUT_MS = 5_000;

// Sanity bounds for the correction factor: road distance must be
// between 80 % and 200 % of the straight-line haversine distance.
const FACTOR_MIN = 0.8;
const FACTOR_MAX = 2.0;

type OsrmMatchResponse = {
  code: string;
  matchings: Array<{ distance: number; duration: number }>;
};

export type OsrmPoint = {
  lat: number | string;
  lng: number | string;
  capturedAt: Date | null;
  accuracyM?: number | string | null;
};

/**
 * Run map matching for an ordered list of GPS points.
 * Returns total matched road distance in km, or null on any failure.
 */
export async function mapMatchTotalKm(points: OsrmPoint[]): Promise<number | null> {
  if (!OSRM_URL || points.length < 2) return null;

  let totalKm = 0;

  for (let i = 0; i < points.length; i += CHUNK_SIZE) {
    const chunk = points.slice(i, i + CHUNK_SIZE);
    if (chunk.length < 2) break;

    const coordStr = chunk
      .map(p => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`)
      .join(';');

    const radiusStr = chunk
      .map(p => {
        const acc = Number(p.accuracyM ?? 0);
        return acc > 0 ? Math.min(Math.max(Math.round(acc), 5), 50) : 25;
      })
      .join(';');

    const tsRaw = chunk.map(p =>
      p.capturedAt ? Math.floor(new Date(p.capturedAt).getTime() / 1000) : null
    );
    const allPresent = tsRaw.every(t => t !== null);
    const isMonotonic = allPresent && tsRaw.every((t, i) => i === 0 || t! >= tsRaw[i - 1]!);
    const tsStr = isMonotonic ? (tsRaw as number[]).join(';') : null;

    try {
      const url = new URL(`${OSRM_URL}/match/v1/driving/${coordStr}`);
      url.searchParams.set('overview', 'false');
      url.searchParams.set('annotations', 'false');
      url.searchParams.set('radiuses', radiusStr);
      if (tsStr) url.searchParams.set('timestamps', tsStr);

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) return null;

      const data: OsrmMatchResponse = await res.json();
      if (data.code !== 'Ok') return null;

      for (const m of data.matchings) {
        totalKm += m.distance / 1000;
      }
    } catch {
      return null;
    }
  }

  return totalKm > 0 ? totalKm : null;
}

export { FACTOR_MIN, FACTOR_MAX };
