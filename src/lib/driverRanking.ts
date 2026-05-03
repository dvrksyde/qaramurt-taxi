import { prisma } from "./prisma";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DriverLevel = "gold" | "silver" | "bronze" | "blocked";

export interface DriverLevelEntry {
  level: DriverLevel;
  score: number;
  ordersCount: number;       // completed in last 30 days
  completionRate: number;    // 0-100 percent
  cancellationCount: number;
}

// ─── Score Calculation ────────────────────────────────────────────────────────

/**
 * Compute driver level from raw stats (last 30 days).
 *
 * Activity points (0-3):
 *   40+ completed  → 3
 *   20-39           → 2
 *   5-19            → 1
 *   0-4             → 0
 *
 * Reliability points (0-3):
 *   95-100% completion → 3
 *   80-94%             → 2
 *   60-79%             → 1
 *   < 60%              → 0
 *
 * Penalty (-3 to 0):
 *   6+ cancellations → -3
 *   3-5              → -2
 *   1-2              → -1
 *   0                → 0
 *
 * Level thresholds:
 *   score >= 6  → gold
 *   score 3-5   → silver
 *   score 0-2   → bronze   ← includes new drivers (score=0)
 *   score < 0   → blocked  ← only if actively cancelled after accepting
 */
export function computeDriverLevel(
  ordersCompleted: number,
  ordersAssigned: number,
  cancellations: number,
): DriverLevelEntry {
  // Activity
  let activity = 0;
  if (ordersCompleted >= 40) activity = 3;
  else if (ordersCompleted >= 20) activity = 2;
  else if (ordersCompleted >= 5)  activity = 1;

  // Reliability
  const completionRate = ordersAssigned > 0
    ? (ordersCompleted / ordersAssigned)
    : (ordersCompleted > 0 ? 1 : 0);
  let reliability = 0;
  if (completionRate >= 0.95) reliability = 3;
  else if (completionRate >= 0.80) reliability = 2;
  else if (completionRate >= 0.60) reliability = 1;

  // Penalty
  let penalty = 0;
  if (cancellations >= 6) penalty = -3;
  else if (cancellations >= 3) penalty = -2;
  else if (cancellations >= 1) penalty = -1;

  const score = activity + reliability + penalty;

  let level: DriverLevel;
  if (score >= 6)      level = "gold";
  else if (score >= 3) level = "silver";
  else if (score >= 0) level = "bronze";  // 0 = new driver / no data → bronze
  else                 level = "blocked"; // only negative score → blocked

  return {
    level,
    score,
    ordersCount: ordersCompleted,
    completionRate: Math.round(completionRate * 100),
    cancellationCount: cancellations,
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export const LEVEL_EMOJI: Record<DriverLevel, string> = {
  gold:    "🥇",
  silver:  "🥈",
  bronze:  "🥉",
  blocked: "⛔",
};

export const LEVEL_LABEL: Record<DriverLevel, string> = {
  gold:    "Золото",
  silver:  "Серебро",
  bronze:  "Бронза",
  blocked: "Блок",
};

export const LEVEL_COLOR: Record<DriverLevel, string> = {
  gold:    "#FFD700",
  silver:  "#94A3B8",
  bronze:  "#CD7F32",
  blocked: "#EF4444",
};

/** Lower = higher dispatch priority. */
export const LEVEL_PRIORITY: Record<DriverLevel, number> = {
  gold:    0,
  silver:  1,
  bronze:  2,
  blocked: 99,
};

// ─── DB Queries ───────────────────────────────────────────────────────────────

function getSince30Days(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d;
}

/**
 * Returns a map of driverId → DriverLevelEntry for ALL active drivers.
 * Uses a single set of grouped queries for efficiency.
 */
export async function getDriverLevelMap(): Promise<Map<number, DriverLevelEntry>> {
  const since = getSince30Days();

  const [completed, assigned, canceled] = await Promise.all([
    // Completed orders (last 30 days)
    prisma.order.groupBy({
      by: ["driverId"],
      where: {
        status: "completed",
        completedAt: { gte: since },
        driverId: { not: null },
      },
      _count: { id: true },
    }),

    // All orders the driver accepted (last 30 days), to compute completion rate
    prisma.order.groupBy({
      by: ["driverId"],
      where: {
        assignedAt: { gte: since },
        driverId: { not: null },
        status: { in: ["completed", "canceled", "arrived", "in_progress"] },
      },
      _count: { id: true },
    }),

    // Canceled AFTER acceptance (last 30 days)
    prisma.order.groupBy({
      by: ["driverId"],
      where: {
        status: "canceled",
        assignedAt: { not: null },   // only if actually assigned (not just missed)
        createdAt: { gte: since },
        driverId: { not: null },
      },
      _count: { id: true },
    }),
  ]);

  const completedMap = new Map(completed.map((r) => [r.driverId!, r._count.id]));
  const assignedMap  = new Map(assigned.map((r)  => [r.driverId!, r._count.id]));
  const canceledMap  = new Map(canceled.map((r)  => [r.driverId!, r._count.id]));

  const allIds = new Set([
    ...completedMap.keys(),
    ...assignedMap.keys(),
    ...canceledMap.keys(),
  ]);

  const levelMap = new Map<number, DriverLevelEntry>();
  for (const driverId of allIds) {
    levelMap.set(
      driverId,
      computeDriverLevel(
        completedMap.get(driverId) ?? 0,
        assignedMap.get(driverId)  ?? 0,
        canceledMap.get(driverId)  ?? 0,
      ),
    );
  }

  return levelMap;
}

/** Get level for a single driver. Falls back to bronze (not blocked) for new drivers. */
export async function getDriverLevel(driverId: number): Promise<DriverLevelEntry> {
  const map = await getDriverLevelMap();
  // New driver (no activity yet) → bronze
  return map.get(driverId) ?? computeDriverLevel(0, 0, 0);
}

// ─── Backward compat (used by drivers/route.ts serialiser) ───────────────────
// Keep these until all callers are migrated.

/** @deprecated Use getDriverLevelMap instead */
export function getStartOfWeek(): Date {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - diffToMonday);
  return startOfWeek;
}
