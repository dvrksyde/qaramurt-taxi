import * as SecureStore from "expo-secure-store";
import { api } from "./api";
import {
  dbInsertPoint,
  dbGetBatch,
  dbCountPending,
  dbMarkSynced,
  dbDeleteAll,
  dbGetAllPoints,
  type PointRow,
} from "./tripDb";

const TRIP_SYNC_KEY    = "driver_trip_sync_v2"; // v2 — pendingPoints moved to SQLite
const TRIP_METRICS_KEY = "driver_trip_metrics_v1";
const POINT_BATCH_SIZE = 50; // increased from 25 — fewer round-trips on weak network

type PendingTripPoint = {
  sequenceNumber: number;
  lat: number;
  lng: number;
  capturedAt: string;
  accuracyM?: number | null;
  speedKmh?: number | null;
  headingDeg?: number | null;
};

// Metadata only — GPS points live in SQLite, not here
type StoredTripSyncState = {
  orderId: number;
  sessionId: number | null;
  nextSequenceNumber: number;
  effectiveBaseFare?: number;
  effectiveCityRatePerKm?: number;
  outOfCityKmRate?: number;
};

let cachedState: StoredTripSyncState | null | undefined;
let activeFlushPromise: Promise<boolean> | null = null;

async function readState(): Promise<StoredTripSyncState | null> {
  if (cachedState !== undefined) return cachedState;

  try {
    const raw = await SecureStore.getItemAsync(TRIP_SYNC_KEY);
    if (!raw) {
      // Check for legacy v1 key — migrate points to SQLite on first run
      await migrateLegacyState();
      return cachedState ?? null;
    }
    cachedState = JSON.parse(raw) as StoredTripSyncState;
  } catch {
    cachedState = null;
  }

  return cachedState;
}

// One-time migration: move pendingPoints from old SecureStore key to SQLite
async function migrateLegacyState(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync("driver_trip_sync_v1");
    if (!raw) { cachedState = null; return; }

    const legacy = JSON.parse(raw) as StoredTripSyncState & { pendingPoints?: PendingTripPoint[] };

    if (legacy.pendingPoints && legacy.pendingPoints.length > 0) {
      for (const p of legacy.pendingPoints) {
        dbInsertPoint(legacy.orderId, {
          sequenceNumber: p.sequenceNumber,
          lat: p.lat,
          lng: p.lng,
          capturedAt: p.capturedAt,
          accuracyM: p.accuracyM ?? null,
          speedKmh: p.speedKmh ?? null,
          headingDeg: p.headingDeg ?? null,
        });
      }
      console.log(`[tripSync] Migrated ${legacy.pendingPoints.length} legacy points to SQLite`);
    }

    const { pendingPoints: _dropped, ...cleanState } = legacy as any;
    cachedState = cleanState as StoredTripSyncState;
    await SecureStore.setItemAsync(TRIP_SYNC_KEY, JSON.stringify(cachedState));
    await SecureStore.deleteItemAsync("driver_trip_sync_v1");
  } catch {
    cachedState = null;
  }
}

async function writeState(state: StoredTripSyncState | null): Promise<void> {
  cachedState = state;

  if (!state) {
    await SecureStore.deleteItemAsync(TRIP_SYNC_KEY);
    return;
  }

  await SecureStore.setItemAsync(TRIP_SYNC_KEY, JSON.stringify(state));
}

async function ensureSession(orderId: number): Promise<StoredTripSyncState | null> {
  const state = await readState();
  if (!state || state.orderId !== orderId) return state;
  if (state.sessionId) return state;

  const res = await api<{
    sessionId: number;
    effectiveBaseFare?: number;
    effectiveCityRatePerKm?: number;
    outOfCityKmRate?: number;
  }>(`/api/driver/orders/${orderId}/trip/start`, { method: "POST" });

  if (!res.data?.sessionId) return state;

  const nextState: StoredTripSyncState = {
    ...state,
    sessionId: res.data.sessionId,
    effectiveBaseFare: res.data.effectiveBaseFare,
    effectiveCityRatePerKm: res.data.effectiveCityRatePerKm,
    outOfCityKmRate: res.data.outOfCityKmRate,
  };
  await writeState(nextState);
  return nextState;
}

export async function startTripSync(orderId: number): Promise<void> {
  const state = await readState();
  if (!state || state.orderId !== orderId) {
    await writeState({ orderId, sessionId: null, nextSequenceNumber: 1 });
  }
  await ensureSession(orderId);
}

export async function queueTripPoint(
  orderId: number,
  point: Omit<PendingTripPoint, "sequenceNumber">,
): Promise<void> {
  let state = await readState();

  if (!state || state.orderId !== orderId) {
    state = { orderId, sessionId: null, nextSequenceNumber: 1 };
  }

  const seq = state.nextSequenceNumber;

  // Write to SQLite first — survives app kill immediately
  dbInsertPoint(orderId, {
    sequenceNumber: seq,
    lat: point.lat,
    lng: point.lng,
    capturedAt: point.capturedAt,
    accuracyM: point.accuracyM ?? null,
    speedKmh: point.speedKmh ?? null,
    headingDeg: point.headingDeg ?? null,
  });

  // Only update the lightweight metadata in SecureStore
  await writeState({ ...state, nextSequenceNumber: seq + 1 });
  void flushTripPoints(orderId);
}

export async function flushTripPoints(orderId: number): Promise<boolean> {
  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  activeFlushPromise = (async () => {
    try {
      while (true) {
        if (dbCountPending(orderId) === 0) return true;

        const state = await ensureSession(orderId);
        if (!state || state.orderId !== orderId || !state.sessionId) {
          return false;
        }

        const batch = dbGetBatch(orderId, POINT_BATCH_SIZE);
        if (batch.length === 0) return true;

        const res = await api(`/api/driver/orders/${orderId}/trip/points`, {
          method: "POST",
          body: JSON.stringify({ sessionId: state.sessionId, points: batch }),
        });

        if (res.error) return false;

        // Mark sent rows as synced — don't delete yet, needed for map matching at trip end
        const maxSeq = batch[batch.length - 1].sequenceNumber;
        dbMarkSynced(orderId, maxSeq);
      }
    } finally {
      activeFlushPromise = null;
    }
  })();

  return activeFlushPromise;
}

/**
 * Inject a pre-created session ID (e.g. from curbside route) so app doesn't
 * make a redundant /trip/start request.
 */
export async function injectSessionId(
  orderId: number,
  sessionId: number,
  effectiveBaseFare?: number,
  effectiveCityRatePerKm?: number,
  outOfCityKmRate?: number,
): Promise<void> {
  let state = await readState();
  if (!state || state.orderId !== orderId) {
    state = { orderId, sessionId: null, nextSequenceNumber: 1 };
  }
  if (!state.sessionId) {
    await writeState({
      ...state,
      sessionId,
      effectiveBaseFare,
      effectiveCityRatePerKm,
      outOfCityKmRate,
    });
  }
}

export async function getTripRates(orderId: number): Promise<{
  effectiveBaseFare: number;
  effectiveCityRatePerKm: number;
  outOfCityKmRate: number;
} | null> {
  const state = await readState();
  if (!state || state.orderId !== orderId || !state.sessionId) return null;
  return {
    effectiveBaseFare:    state.effectiveBaseFare    ?? 290,
    effectiveCityRatePerKm: state.effectiveCityRatePerKm ?? 80,
    outOfCityKmRate:      state.outOfCityKmRate      ?? 0,
  };
}

/**
 * Returns pre-filtered GPS points for GraphHopper map matching at trip end.
 *
 * Teacher recommendation: filter BEFORE matching so HMM gets clean data:
 *   1. accuracy > 25m → skip (cell tower positions, not GPS)
 *   2. implied speed > 120 km/h between consecutive points → skip (GPS jump)
 *   3. distance < 10m from previous kept point → skip (stationary GPS noise)
 *
 * After these filters, map matching (HMM) handles remaining road-snapping.
 */
export function getTripPointsForMatching(orderId: number): Array<{ lat: number; lng: number }> {
  const all = dbGetAllPoints(orderId);
  if (all.length < 2) return all.map(p => ({ lat: p.lat, lng: p.lng }));

  const filtered: Array<{ lat: number; lng: number; capturedAt: string }> = [];

  for (const p of all) {
    // 1. accuracy > 25m → skip
    if (p.accuracyM !== null && p.accuracyM > 25) continue;

    if (filtered.length > 0) {
      const prev = filtered[filtered.length - 1];
      const dLat = (p.lat - prev.lat) * (Math.PI / 180);
      const dLng = (p.lng - prev.lng) * (Math.PI / 180);
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(prev.lat * Math.PI / 180) * Math.cos(p.lat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
      const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      // 3. < 10m → stationary GPS noise
      if (distKm < 0.010) continue;

      // 2. implied speed > 120 km/h → GPS jump
      const dtMs = new Date(p.capturedAt).getTime() - new Date(prev.capturedAt).getTime();
      if (dtMs > 0) {
        const impliedSpeedKmh = distKm / (dtMs / 3_600_000);
        if (impliedSpeedKmh > 120) continue;
      }
    }

    filtered.push({ lat: p.lat, lng: p.lng, capturedAt: p.capturedAt });
  }

  return filtered.map(p => ({ lat: p.lat, lng: p.lng }));
}

export async function clearTripSync(orderId?: number): Promise<void> {
  const state = await readState();
  if (!state) return;
  if (orderId !== undefined && state.orderId !== orderId) return;
  dbDeleteAll(state.orderId); // clear SQLite rows for this trip
  await writeState(null);
}

// ── Trip metrics (survives app kill) ─────────────────────────────────────────

export type TripMetrics = {
  orderId: number;
  tripDistance: number;
  tripPrice: number;
  outOfCityKm: number;
  outOfCitySeconds: number;
  savedAt: number;
};

export async function saveTripMetrics(metrics: TripMetrics): Promise<void> {
  try {
    await SecureStore.setItemAsync(TRIP_METRICS_KEY, JSON.stringify(metrics));
  } catch { /* ignore */ }
}

export async function loadTripMetrics(orderId: number): Promise<TripMetrics | null> {
  try {
    const raw = await SecureStore.getItemAsync(TRIP_METRICS_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as TripMetrics;
    return m.orderId === orderId ? m : null;
  } catch { return null; }
}

export async function clearTripMetrics(): Promise<void> {
  try { await SecureStore.deleteItemAsync(TRIP_METRICS_KEY); } catch { /* ignore */ }
}

// ── Pending Completion ────────────────────────────────────────────────────────

const PENDING_COMPLETION_KEY = "driver_pending_completion_v1";

export type PendingCompletion = {
  orderId: number;
  body: Record<string, unknown>;
  savedAt: number;
};

export async function savePendingCompletion(data: PendingCompletion): Promise<void> {
  await SecureStore.setItemAsync(PENDING_COMPLETION_KEY, JSON.stringify(data));
}

export async function getPendingCompletion(): Promise<PendingCompletion | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_COMPLETION_KEY);
    return raw ? (JSON.parse(raw) as PendingCompletion) : null;
  } catch { return null; }
}

export async function clearPendingCompletion(): Promise<void> {
  try { await SecureStore.deleteItemAsync(PENDING_COMPLETION_KEY); } catch { /* ignore */ }
}

let isSyncingCompletion = false;

export async function syncPendingCompletion(): Promise<boolean> {
  if (isSyncingCompletion) return false;
  isSyncingCompletion = true;
  try {
    const pending = await getPendingCompletion();
    if (!pending) return true;

    await flushTripPoints(pending.orderId).catch(() => {});

    const res = await api(`/api/driver/orders/${pending.orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify(pending.body),
    });

    if (res.error) {
      console.warn("[pendingCompletion] Retry failed:", res.error);
      return false;
    }

    await clearPendingCompletion();
    await clearPendingStatus();
    await clearTripSync(pending.orderId);
    console.log(`[pendingCompletion] Synced order ${pending.orderId} successfully`);
    return true;
  } finally {
    isSyncingCompletion = false;
  }
}

// ── Pending Status ────────────────────────────────────────────────────────────

const PENDING_STATUS_KEY = "driver_pending_status_v1";

export type PendingStatus = {
  orderId: number;
  status: "arrived" | "in_progress";
  savedAt: number;
};

export async function savePendingStatus(data: PendingStatus): Promise<void> {
  await SecureStore.setItemAsync(PENDING_STATUS_KEY, JSON.stringify(data));
}

export async function getPendingStatus(): Promise<PendingStatus | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_STATUS_KEY);
    return raw ? (JSON.parse(raw) as PendingStatus) : null;
  } catch { return null; }
}

export async function clearPendingStatus(): Promise<void> {
  try { await SecureStore.deleteItemAsync(PENDING_STATUS_KEY); } catch { /* ignore */ }
}

export async function syncPendingStatus(): Promise<boolean> {
  const pending = await getPendingStatus();
  if (!pending) return true;

  const res = await api(`/api/driver/orders/${pending.orderId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: pending.status }),
  });

  if (res.error) {
    console.warn(`[pendingStatus] Retry ${pending.status} failed:`, res.error);
    return false;
  }

  await clearPendingStatus();
  console.log(`[pendingStatus] Synced ${pending.status} for order ${pending.orderId}`);
  return true;
}
