/**
 * Smart GPS Odometer — Фаза 2 (anti-teleport hardening)
 *
 * ИСПРАВЛЕНЫ критические баги из-за которых накапливались фантомные км:
 *
 *   Bug 1: Kalman-фильтр обновлял своё состояние даже при плохой точности GPS
 *          → постепенно "сползал" к неправильным координатам (вышка сотовой связи)
 *          → каждый следующий шаг измерялся от неправильной позиции → +46 км
 *   Bug 2: Нет проверки конфликта скорость-расстояние
 *          → GPS говорит "стоим" (0 км/ч) но координата прыгнула на 200м → считается
 *   Bug 3: MAX_DISTANCE_KM = 300м слишком мягко, урезаем до 150м
 *   Bug 4: MAX_GAP_MS = 45сек слишком долго, GPS может выдать прыжок после 30сек паузы
 */

// ─── Haversine ─────────────────────────────────────────────────────────────────
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

// ─── Kalman filter ─────────────────────────────────────────────────────────────
interface KalmanState {
  lat: number;
  lng: number;
  variance: number;
}

function kalmanUpdate(
  state: KalmanState,
  measuredLat: number,
  measuredLng: number,
  accuracyM: number,
): KalmanState {
  const PROCESS_NOISE = 0.0001;
  const predictedVariance = state.variance + PROCESS_NOISE;
  const measurementNoise = Math.max(accuracyM / 111_000, 0.00001) ** 2;
  const K = predictedVariance / (predictedVariance + measurementNoise);
  return {
    lat: state.lat + K * (measuredLat - state.lat),
    lng: state.lng + K * (measuredLng - state.lng),
    variance: (1 - K) * predictedVariance,
  };
}

// ─── Odometer state ────────────────────────────────────────────────────────────
interface OdometerState {
  kalman: KalmanState | null;
  lastTimestamp: number | null;
}

let state: OdometerState = { kalman: null, lastTimestamp: null };

export function resetOdometer(): void {
  state = { kalman: null, lastTimestamp: null };
}

// ─── Thresholds ────────────────────────────────────────────────────────────────
const MAX_ACCURACY_M      = 50;    // Ignore GPS fix worse than 50m
const MAX_SPEED_KMH       = 140;   // Physically impossible → GPS glitch
const MIN_DISTANCE_KM     = 0.010; // 10m — don't count micro-movements
const MAX_DISTANCE_KM     = 0.150; // 150m max per step (was 300m — too loose)
const STATIONARY_SPEED    = 2.0;   // m/s (~7.2 km/h) — below this = stopped
const STATIONARY_DIST_KM  = 0.020; // 20m — drift while parked, don't count
const MAX_GAP_MS          = 30_000; // 30 sec gap → re-anchor (was 45s)

/**
 * Process a GPS reading from the background task.
 * Returns filtered distance increment in km (0 = skip this point).
 */
export function processGpsPoint(
  lat: number,
  lng: number,
  accuracyM: number | null,
  speedMs: number | null,
  timestamp: number,
): number {
  const accuracy = accuracyM ?? 30;

  // ── 1. Accuracy filter ─────────────────────────────────────────────────────
  // CRITICAL FIX: Do NOT update Kalman state for bad accuracy.
  // Old code was updating Kalman with low-quality readings, causing it to
  // gradually drift toward wrong positions (cell-tower lock → fake 46 km).
  if (accuracy > MAX_ACCURACY_M) {
    state.lastTimestamp = timestamp; // update timestamp to prevent gap ghost
    return 0;
  }

  // ── 2. First point — init Kalman ───────────────────────────────────────────
  if (!state.kalman) {
    state.kalman = { lat, lng, variance: 1 };
    state.lastTimestamp = timestamp;
    return 0;
  }

  // ── 3. Time gap guard ──────────────────────────────────────────────────────
  const gapMs = timestamp - (state.lastTimestamp ?? timestamp);
  if (gapMs > MAX_GAP_MS) {
    // GPS was off — don't count ghost distance, re-anchor to current position
    state.kalman = { lat, lng, variance: 1 };
    state.lastTimestamp = timestamp;
    return 0;
  }

  // ── 4. Kalman smooth ───────────────────────────────────────────────────────
  const smoothed = kalmanUpdate(state.kalman, lat, lng, accuracy);

  // ── 5. Distance from smoothed prev → smoothed current ─────────────────────
  const d = haversine(state.kalman.lat, state.kalman.lng, smoothed.lat, smoothed.lng);

  // ── 6. Speed validator (physics check) ────────────────────────────────────
  if (gapMs > 0) {
    const impliedSpeedKmh = d / (gapMs / 3_600_000);
    if (impliedSpeedKmh > MAX_SPEED_KMH) {
      // GPS teleport — ignore, keep old Kalman state
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
  const reportedSpeedKmh = speedMs !== null ? speedMs * 3.6 : null;

  // Standard: GPS says slow AND distance is small → parked
  const isStationary =
    speedMs !== null && speedMs < STATIONARY_SPEED && d < STATIONARY_DIST_KM;

  // CRITICAL FIX: Speed-distance conflict.
  // GPS says < 10 km/h but position jumped > 30m → cell tower lock / multipath error.
  // This is the main cause of phantom km while driver is waiting.
  const isSpeedDistanceConflict =
    reportedSpeedKmh !== null &&
    reportedSpeedKmh < 10 &&
    d > 0.030;

  if (isStationary || isSpeedDistanceConflict) {
    state.kalman = smoothed;
    state.lastTimestamp = timestamp;
    return 0;
  }

  // ── All checks passed — accumulate distance ────────────────────────────────
  state.kalman = smoothed;
  state.lastTimestamp = timestamp;
  return d; // km
}
