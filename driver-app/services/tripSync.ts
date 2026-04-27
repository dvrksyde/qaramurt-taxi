import * as SecureStore from "expo-secure-store";
import { api } from "./api";

const TRIP_SYNC_KEY = "driver_trip_sync_v1";
const POINT_BATCH_SIZE = 25;

type PendingTripPoint = {
  sequenceNumber: number;
  lat: number;
  lng: number;
  capturedAt: string;
  accuracyM?: number | null;
  speedKmh?: number | null;
  headingDeg?: number | null;
};

type StoredTripSyncState = {
  orderId: number;
  sessionId: number | null;
  nextSequenceNumber: number;
  pendingPoints: PendingTripPoint[];
  // Server-resolved rates (correct for "Любой" orders with Comfort driver)
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
    cachedState = raw ? (JSON.parse(raw) as StoredTripSyncState) : null;
  } catch {
    cachedState = null;
  }

  return cachedState;
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
    await writeState({
      orderId,
      sessionId: null,
      nextSequenceNumber: 1,
      pendingPoints: [],
    });
  }

  await ensureSession(orderId);
}

export async function queueTripPoint(
  orderId: number,
  point: Omit<PendingTripPoint, "sequenceNumber">
): Promise<void> {
  let state = await readState();

  if (!state || state.orderId !== orderId) {
    state = {
      orderId,
      sessionId: null,
      nextSequenceNumber: 1,
      pendingPoints: [],
    };
  }

  const nextState: StoredTripSyncState = {
    ...state,
    nextSequenceNumber: state.nextSequenceNumber + 1,
    pendingPoints: [
      ...state.pendingPoints,
      {
        ...point,
        sequenceNumber: state.nextSequenceNumber,
      },
    ],
  };

  await writeState(nextState);
  void flushTripPoints(orderId);
}

export async function flushTripPoints(orderId: number): Promise<boolean> {
  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  activeFlushPromise = (async () => {
    try {
      while (true) {
        let state = await readState();
        if (!state || state.orderId !== orderId) return true;
        if (state.pendingPoints.length === 0) return true;

        state = await ensureSession(orderId);
        if (!state || state.orderId !== orderId || !state.sessionId) {
          return false;
        }

        const batch = state.pendingPoints.slice(0, POINT_BATCH_SIZE);
        const res = await api(`/api/driver/orders/${orderId}/trip/points`, {
          method: "POST",
          body: JSON.stringify({
            sessionId: state.sessionId,
            points: batch,
          }),
        });

        if (res.error) {
          return false;
        }

        const latestState = await readState();
        if (!latestState || latestState.orderId !== orderId) {
          return true;
        }

        await writeState({
          ...latestState,
          sessionId: state.sessionId,
          pendingPoints: latestState.pendingPoints.slice(batch.length),
        });
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
 * Also stores server-resolved rates so getTripRates() works correctly.
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
    state = { orderId, sessionId: null, nextSequenceNumber: 1, pendingPoints: [] };
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

/** Returns server-resolved rates for the active trip session (or null if not started yet). */
export async function getTripRates(orderId: number): Promise<{
  effectiveBaseFare: number;
  effectiveCityRatePerKm: number;
  outOfCityKmRate: number;
} | null> {
  const state = await readState();
  if (!state || state.orderId !== orderId || !state.sessionId) return null;
  return {
    effectiveBaseFare: state.effectiveBaseFare ?? 290,
    effectiveCityRatePerKm: state.effectiveCityRatePerKm ?? 80,
    outOfCityKmRate: state.outOfCityKmRate ?? 0,
  };
}

export async function clearTripSync(orderId?: number): Promise<void> {
  const state = await readState();
  if (!state) return;
  if (orderId !== undefined && state.orderId !== orderId) return;
  await writeState(null);
}
