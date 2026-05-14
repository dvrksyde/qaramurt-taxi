/**
 * SQLite layer for GPS trip points and Kalman state.
 *
 * trip_points: each GPS point is a separate row.
 *   synced=0 → pending server upload
 *   synced=1 → sent to server (kept for local map matching at trip end)
 *   All rows are deleted via dbDeleteAll() only after trip is fully complete.
 *
 * kalman_state: single row, always overwritten — persists Kalman filter
 *   across background GPS task restarts (Android kills background tasks
 *   aggressively on some OEMs).
 */

import * as SQLite from "expo-sqlite";

export type PointRow = {
  sequenceNumber: number;
  lat: number;
  lng: number;
  capturedAt: string;
  accuracyM: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
};

let _db: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync("trip_points.db");
    _db.execSync(`
      CREATE TABLE IF NOT EXISTS trip_points (
        orderId        INTEGER NOT NULL,
        sequenceNumber INTEGER NOT NULL,
        lat            REAL    NOT NULL,
        lng            REAL    NOT NULL,
        capturedAt     TEXT    NOT NULL,
        accuracyM      REAL,
        speedKmh       REAL,
        headingDeg     REAL,
        synced         INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (orderId, sequenceNumber)
      );
      CREATE TABLE IF NOT EXISTS kalman_state (
        id            INTEGER PRIMARY KEY,
        lat           REAL    NOT NULL,
        lng           REAL    NOT NULL,
        variance      REAL    NOT NULL,
        lastTimestamp INTEGER NOT NULL
      )
    `);
    // Migration from Phase 2 schema (no synced column)
    try {
      _db.execSync("ALTER TABLE trip_points ADD COLUMN synced INTEGER NOT NULL DEFAULT 0");
    } catch { /* column already exists — ok */ }
  }
  return _db;
}

// ── Trip points ───────────────────────────────────────────────────────────────

export function dbInsertPoint(orderId: number, point: PointRow): void {
  try {
    getDb().runSync(
      `INSERT OR IGNORE INTO trip_points
         (orderId, sequenceNumber, lat, lng, capturedAt, accuracyM, speedKmh, headingDeg, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      orderId,
      point.sequenceNumber,
      point.lat,
      point.lng,
      point.capturedAt,
      point.accuracyM ?? null,
      point.speedKmh ?? null,
      point.headingDeg ?? null,
    );
  } catch (e) {
    console.warn("[tripDb] insertPoint failed:", e);
  }
}

/** Pending points not yet sent to server */
export function dbGetBatch(orderId: number, limit: number): PointRow[] {
  try {
    return getDb().getAllSync<PointRow>(
      `SELECT sequenceNumber, lat, lng, capturedAt, accuracyM, speedKmh, headingDeg
       FROM trip_points
       WHERE orderId = ? AND synced = 0
       ORDER BY sequenceNumber ASC
       LIMIT ?`,
      orderId,
      limit,
    );
  } catch (e) {
    console.warn("[tripDb] getBatch failed:", e);
    return [];
  }
}

/** All points for the trip — used by GraphHopper map matching at trip end */
export function dbGetAllPoints(orderId: number): Array<{
  lat: number;
  lng: number;
  capturedAt: string;
  accuracyM: number | null;
  speedKmh: number | null;
}> {
  try {
    return getDb().getAllSync<{
      lat: number;
      lng: number;
      capturedAt: string;
      accuracyM: number | null;
      speedKmh: number | null;
    }>(
      `SELECT lat, lng, capturedAt, accuracyM, speedKmh
       FROM trip_points
       WHERE orderId = ?
       ORDER BY sequenceNumber ASC`,
      orderId,
    );
  } catch (e) {
    console.warn("[tripDb] getAllPoints failed:", e);
    return [];
  }
}

export function dbCountPending(orderId: number): number {
  try {
    const row = getDb().getFirstSync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trip_points WHERE orderId = ? AND synced = 0",
      orderId,
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Mark batch as synced (don't delete — needed for map matching at trip end) */
export function dbMarkSynced(orderId: number, maxSeq: number): void {
  try {
    getDb().runSync(
      "UPDATE trip_points SET synced = 1 WHERE orderId = ? AND sequenceNumber <= ?",
      orderId,
      maxSeq,
    );
  } catch (e) {
    console.warn("[tripDb] markSynced failed:", e);
  }
}

/** Delete all points for trip — called only after trip is fully complete */
export function dbDeleteAll(orderId: number): void {
  try {
    getDb().runSync("DELETE FROM trip_points WHERE orderId = ?", orderId);
  } catch (e) {
    console.warn("[tripDb] deleteAll failed:", e);
  }
}

// ── Kalman state ──────────────────────────────────────────────────────────────

export type KalmanSnapshot = {
  lat: number;
  lng: number;
  variance: number;
  lastTimestamp: number;
};

export function dbSaveKalmanState(snap: KalmanSnapshot): void {
  try {
    getDb().runSync(
      `INSERT OR REPLACE INTO kalman_state (id, lat, lng, variance, lastTimestamp)
       VALUES (1, ?, ?, ?, ?)`,
      snap.lat,
      snap.lng,
      snap.variance,
      snap.lastTimestamp,
    );
  } catch { /* non-critical */ }
}

export function dbLoadKalmanState(): KalmanSnapshot | null {
  try {
    return getDb().getFirstSync<KalmanSnapshot>(
      "SELECT lat, lng, variance, lastTimestamp FROM kalman_state WHERE id = 1",
    ) ?? null;
  } catch {
    return null;
  }
}

export function dbClearKalmanState(): void {
  try {
    getDb().runSync("DELETE FROM kalman_state");
  } catch { /* ignore */ }
}
