/**
 * Smart GPS Odometer — Фаза 3 (adaptive distance cap)
 *
 * Фаза 2 исправления:
 *   Bug 1: Kalman-фильтр обновлял состояние при плохой точности → drift
 *   Bug 2: Нет проверки конфликта скорость-расстояние
 *
 * Фаза 3 исправления:
 *   Bug 3: MAX_DISTANCE_KM = 40м — СЛИШКОМ ЖЁСТКО. При 60 км/ч + 2–3с задержка GPS
 *          (Android Doze, переключение приложений) шаг = 50–80м → дропался.
 *          → НЕДОРАСЧЁТ дистанции — реальные км не считались.
 *          FIX: адаптивный лимит = MAX_SPEED × gapTime × 1.3
 *   Bug 4: chipConfirmsMoving = false при speedMs === null
 *          → на устройствах без GPS speed пробки полностью терялись
 *          FIX: если speed = null, не блокируем шаги > MIN_DISTANCE
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
const MAX_ACCURACY_M      = 25;    // Ignore GPS fix worse than 25m (teacher rec.)
const MAX_SPEED_KMH       = 120;   // 120 km/h cap (teacher rec.) → GPS glitch
const MIN_DISTANCE_KM     = 0.010; // 10m — don't count micro-movements
// Phase 3: MAX_DISTANCE is now DYNAMIC — see computeMaxDistKm() below.
// Old fixed 40m was too strict for 60+ km/h with 2–3s GPS gaps.
const MIN_MAX_DIST_KM     = 0.040; // Floor: 40m (1s at 120 km/h = 33m + buffer)
const ABS_MAX_DIST_KM     = 0.300; // Ceiling: 300m (safety net against teleports)
const STATIONARY_SPEED    = 2.0;   // m/s (~7.2 km/h) — below this = stopped
const STATIONARY_DIST_KM  = 0.020; // 20m — drift while parked, don't count
const MAX_GAP_MS          = 30_000; // 30 sec gap → re-anchor (was 45s)

/**
 * Compute the maximum plausible distance for this GPS step,
 * based on the actual time elapsed since the previous reading.
 *
 * Formula: MAX_SPEED_KMH × (gapMs / 3_600_000) × 1.3 (30% buffer for curves)
 * Clamped to [MIN_MAX_DIST_KM, ABS_MAX_DIST_KM].
 *
 * Examples:
 *   1s gap → 120 × 0.000278 × 1.3 = 0.043 km (43m)
 *   2s gap → 120 × 0.000556 × 1.3 = 0.087 km (87m) — previously dropped!
 *   3s gap → 120 × 0.000833 × 1.3 = 0.130 km (130m) — previously dropped!
 *   5s gap → 120 × 0.001389 × 1.3 = 0.217 km (217m)
 */
function computeMaxDistKm(gapMs: number): number {
  if (gapMs <= 0) return MIN_MAX_DIST_KM;
  const maxPlausible = MAX_SPEED_KMH * (gapMs / 3_600_000) * 1.3;
  return Math.max(MIN_MAX_DIST_KM, Math.min(maxPlausible, ABS_MAX_DIST_KM));
}

export type GpsProcessResult = {
  d: number;                    // distance increment km (0 = not counted)
  smoothedLat: number | null;   // Kalman-smoothed lat (null = bad accuracy, skip queuing)
  smoothedLng: number | null;
};

/**
 * Process a GPS reading from the background task.
 * Returns distance increment + Kalman-smoothed coordinates.
 * smoothedLat/Lng = null when accuracy is too poor to trust the position.
 */
export function processGpsPoint(
  lat: number,
  lng: number,
  accuracyM: number | null,
  speedMs: number | null,
  timestamp: number,
): GpsProcessResult {
  const accuracy = accuracyM ?? 30;

  // ── 1. Accuracy filter ─────────────────────────────────────────────────────
  if (accuracy > MAX_ACCURACY_M) {
    state.lastTimestamp = timestamp;
    return { d: 0, smoothedLat: null, smoothedLng: null };
  }

  // ── 2. First point — init Kalman ───────────────────────────────────────────
  if (!state.kalman) {
    state.kalman = { lat, lng, variance: 1 };
    state.lastTimestamp = timestamp;
    return { d: 0, smoothedLat: lat, smoothedLng: lng };
  }

  // ── 3. Time gap guard ──────────────────────────────────────────────────────
  const gapMs = timestamp - (state.lastTimestamp ?? timestamp);
  if (gapMs > MAX_GAP_MS) {
    state.kalman = { lat, lng, variance: 1 };
    state.lastTimestamp = timestamp;
    return { d: 0, smoothedLat: lat, smoothedLng: lng };
  }

  // ── 4. Kalman smooth ───────────────────────────────────────────────────────
  const smoothed = kalmanUpdate(state.kalman, lat, lng, accuracy);

  // ── 5. Distance from smoothed prev → smoothed current ─────────────────────
  const d = haversine(state.kalman.lat, state.kalman.lng, smoothed.lat, smoothed.lng);

  // ── 6. Speed validator (physics check) ────────────────────────────────────
  if (gapMs > 0) {
    const impliedSpeedKmh = d / (gapMs / 3_600_000);
    if (impliedSpeedKmh > MAX_SPEED_KMH) {
      state.lastTimestamp = timestamp;
      return { d: 0, smoothedLat: null, smoothedLng: null };
    }
  }

  // ── 7. Distance range filter ───────────────────────────────────────────────
  // Phase 3: dynamic max distance based on actual time gap.
  // GPS chip speed (speedMs) is more reliable than position delta at slow speeds.
  // If the chip confirms the car IS moving (> 3.6 km/h), count even small steps.
  // If speed is unknown (null), still count steps above MIN_DISTANCE — don't
  // penalize devices that don't report GPS speed (common on budget Androids).
  const reportedSpeedKmh = speedMs !== null ? speedMs * 3.6 : null;
  const chipConfirmsMoving = reportedSpeedKmh !== null ? reportedSpeedKmh > 3.6 : null;
  // null = unknown (device doesn't report speed) — don't block valid steps

  const maxDistKm = computeMaxDistKm(gapMs);

  if (d > maxDistKm) {
    // Too large for the elapsed time — GPS teleport
    state.kalman = smoothed;
    state.lastTimestamp = timestamp;
    return { d: 0, smoothedLat: null, smoothedLng: null };
  }

  if (d < MIN_DISTANCE_KM && chipConfirmsMoving === false) {
    // Tiny movement AND chip EXPLICITLY says slow/stopped → GPS jitter at rest, skip
    // Note: chipConfirmsMoving === null (unknown speed) → do NOT skip, count the step
    state.kalman = smoothed;
    state.lastTimestamp = timestamp;
    return { d: 0, smoothedLat: smoothed.lat, smoothedLng: smoothed.lng };
  }

  // ── 8. Stationary detector ─────────────────────────────────────────────────
  // Only filter as stationary if chip explicitly reports stopped (< 1 km/h).
  const isStationary =
    speedMs !== null && speedMs < 0.3 && d < STATIONARY_DIST_KM;
  const isSpeedDistanceConflict =
    reportedSpeedKmh !== null &&
    reportedSpeedKmh < 10 &&
    d > 0.030;

  if (isStationary || isSpeedDistanceConflict) {
    state.kalman = smoothed;
    state.lastTimestamp = timestamp;
    return { d: 0, smoothedLat: smoothed.lat, smoothedLng: smoothed.lng };
  }

  // ── All checks passed — accumulate distance ────────────────────────────────
  state.kalman = smoothed;
  state.lastTimestamp = timestamp;
  return { d, smoothedLat: smoothed.lat, smoothedLng: smoothed.lng };
}
