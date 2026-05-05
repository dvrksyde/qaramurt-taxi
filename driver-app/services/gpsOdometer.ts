/**
 * Smart GPS Odometer — Фаза 1 реновации
 *
 * Решает проблему 290₸ и неправильного расчёта дистанции:
 *
 * Проблемы сырого GPS:
 *   - Дрейф при стоянке (10-50м накапливается → лишние км)
 *   - Плохая точность в ауле (accuracy > 50м → прыжки)
 *   - Глюки GPS (200м прыжок за 3 сек = 240 км/ч — физически невозможно)
 *   - Пропуск точек при слабом сигнале → статус in_progress но 0 км
 *
 * Что делает этот модуль:
 *   1. Kalman filter — сглаживает GPS дрейф
 *   2. Accuracy filter — игнорирует точки с плохим сигналом
 *   3. Speed validator — отбрасывает физически невозможные прыжки
 *   4. Stationary detector — не накапливает расстояние при стоянке
 *   5. Time gap guard — не накапливает если долго нет точек (GPS упал)
 */

// ─── Haversine (та же что в background task) ──────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Kalman filter state ───────────────────────────────────────────────────────
interface KalmanState {
  lat: number;
  lng: number;
  /** Estimated error (variance). Starts high = low confidence. */
  variance: number;
}

/**
 * 1D Kalman filter applied independently to lat and lng.
 * Returns smoothed coordinates and updated variance.
 *
 * minAccuracy — GPS reported accuracy in meters (used as measurement noise).
 * The higher the accuracy number, the less we trust this reading.
 */
function kalmanUpdate(
  state: KalmanState,
  measuredLat: number,
  measuredLng: number,
  accuracyM: number,
): KalmanState {
  // Process noise — how much we expect position to drift between measurements
  const PROCESS_NOISE = 0.0001; // ~11m max drift per step

  // Grow variance (prediction step)
  const predictedVariance = state.variance + PROCESS_NOISE;

  // Measurement noise from GPS accuracy (convert metres → degrees approx)
  const measurementNoise = Math.max(accuracyM / 111_000, 0.00001) ** 2;

  // Kalman gain — how much to trust the new measurement
  const K = predictedVariance / (predictedVariance + measurementNoise);

  return {
    lat: state.lat + K * (measuredLat - state.lat),
    lng: state.lng + K * (measuredLng - state.lng),
    variance: (1 - K) * predictedVariance,
  };
}

// ─── Odometer state ───────────────────────────────────────────────────────────
interface OdometerState {
  kalman: KalmanState | null;
  lastTimestamp: number | null; // ms
}

// Module-level state (lives for the session, reset on trip start)
let state: OdometerState = {
  kalman: null,
  lastTimestamp: null,
};

export function resetOdometer(): void {
  state = { kalman: null, lastTimestamp: null };
}

// ─── Thresholds ───────────────────────────────────────────────────────────────
const MAX_ACCURACY_M      = 60;   // Ignore GPS fix worse than 60m
const MAX_SPEED_KMH       = 160;  // Physically impossible for a taxi → GPS glitch
const MIN_DISTANCE_KM     = 0.010; // 10m — don't count micro-movements
const MAX_DISTANCE_KM     = 0.3;  // 300m in one step — large jump filter
const STATIONARY_SPEED    = 1.5;  // m/s (~5.4 km/h) — below this = probably parked
const STATIONARY_DIST_KM  = 0.015; // 15m — drift while parked, don't count
const MAX_GAP_MS          = 45_000; // 45 sec gap → GPS was off, don't accumulate

/**
 * Process a new GPS reading from the background task.
 *
 * Returns the FILTERED distance increment in km (0 if the point should be skipped).
 * Add this to your tripDistance accumulator.
 *
 * @param lat         Raw GPS latitude
 * @param lng         Raw GPS longitude
 * @param accuracyM   GPS reported accuracy in metres (lower = better)
 * @param speedMs     GPS reported speed in m/s (null if unavailable)
 * @param timestamp   Unix timestamp in ms
 */
export function processGpsPoint(
  lat: number,
  lng: number,
  accuracyM: number | null,
  speedMs: number | null,
  timestamp: number,
): number {
  const accuracy = accuracyM ?? 30; // Assume 30m if not reported

  // ── 1. Accuracy filter ─────────────────────────────────────────────────────
  if (accuracy > MAX_ACCURACY_M) {
    // Bad GPS fix — update Kalman state with low confidence but don't accumulate
    if (state.kalman) {
      state.kalman = kalmanUpdate(state.kalman, lat, lng, accuracy);
    }
    state.lastTimestamp = timestamp;
    return 0;
  }

  // ── 2. First point — init Kalman, no distance ──────────────────────────────
  if (!state.kalman) {
    state.kalman = { lat, lng, variance: 1 }; // High initial variance = low confidence
    state.lastTimestamp = timestamp;
    return 0;
  }

  // ── 3. Time gap guard ──────────────────────────────────────────────────────
  const gapMs = timestamp - (state.lastTimestamp ?? timestamp);
  if (gapMs > MAX_GAP_MS) {
    // GPS was off/unavailable — don't count ghost distance
    // Just re-anchor to new position
    state.kalman = { lat, lng, variance: 1 };
    state.lastTimestamp = timestamp;
    return 0;
  }

  // ── 4. Kalman smooth ───────────────────────────────────────────────────────
  const smoothed = kalmanUpdate(state.kalman, lat, lng, accuracy);

  // ── 5. Distance from smoothed prev → smoothed current ────────────────────
  const d = haversine(state.kalman.lat, state.kalman.lng, smoothed.lat, smoothed.lng);

  // ── 6. Speed validator (physics check) ────────────────────────────────────
  if (gapMs > 0) {
    const impliedSpeedKmh = (d / (gapMs / 3600_000));
    if (impliedSpeedKmh > MAX_SPEED_KMH) {
      // GPS teleport — ignore point entirely, keep old Kalman state
      state.lastTimestamp = timestamp;
      return 0;
    }
  }

  // ── 7. Distance range filter ───────────────────────────────────────────────
  if (d < MIN_DISTANCE_KM || d > MAX_DISTANCE_KM) {
    state.kalman = smoothed;
    state.lastTimestamp = timestamp;
    return 0;
  }

  // ── 8. Stationary detector ─────────────────────────────────────────────────
  // If GPS says we're moving slowly AND distance is small → driver is parked
  const isStationary =
    speedMs !== null && speedMs < STATIONARY_SPEED && d < STATIONARY_DIST_KM;
  if (isStationary) {
    state.kalman = smoothed;
    state.lastTimestamp = timestamp;
    return 0;
  }

  // ── All checks passed — accumulate distance ────────────────────────────────
  state.kalman = smoothed;
  state.lastTimestamp = timestamp;
  return d; // km
}
