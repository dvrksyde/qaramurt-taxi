import { Queue, Worker } from "bullmq";
import { prisma } from "./prisma";
import { redis } from "./redis";
import { getDriverLevelMap, LEVEL_PRIORITY } from "./driverRanking";

// ─── Connection ───────────────────────────────────────────────────────────────

const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
};

const globalForQueue = global as unknown as {
  orderDistributionQueue: Queue;
  orderDistributionWorker: Worker;
};

// ─── Queue ────────────────────────────────────────────────────────────────────

export const orderDistributionQueue =
  globalForQueue.orderDistributionQueue ||
  new Queue("order-distribution", {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForQueue.orderDistributionQueue = orderDistributionQueue;
}

// ─── Dispatch configuration ───────────────────────────────────────────────────

/**
 * Multi-step radius expansion:
 *   step 1: 1.5 km  → notify gold+silver+bronze (not blocked), wait 15 s
 *   step 2: 3.0 km  → notify NEW drivers (not blocked), wait 15 s
 *   step 3: 5.0 km  → notify NEW drivers (not blocked), wait 15 s
 *   step 4: broadcast ALL online drivers (last resort)
 *
 * Within every step, drivers are sorted by level priority first,
 * then by distance (nearest wins within same level).
 *
 * If a step finds zero eligible new drivers the worker advances
 * to the next step immediately (no additional delay).
 */
const STEP_RADII: Record<number, number> = {
  1: 1.5,
  2: 3.0,
  3: 5.0,
};
const STEP_DELAY_MS = 15_000;
const STEP_JITTER_MS = 2_000; // ±2 s so bulk orders don't fire simultaneously

function jittered(base: number) {
  return base + Math.floor(Math.random() * STEP_JITTER_MS * 2) - STEP_JITTER_MS;
}

// ─── Job types ────────────────────────────────────────────────────────────────

export interface DispatchStepJobData {
  orderId: number;
  step: number;               // 1 | 2 | 3 | 4
  notifiedIds: number[];      // driver IDs already sent an alert — don't repeat
  pickupLat: number;
  pickupLng: number;
  classId: number | null;
  alertData: Record<string, unknown>;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Schedule the next dispatch step (possibly immediately if no drivers found). */
async function scheduleNextStep(
  data: DispatchStepJobData,
  delay: number,
) {
  const nextData: DispatchStepJobData = { ...data, step: data.step + 1 };
  await orderDistributionQueue.add("dispatch-step", nextData, {
    delay: Math.max(0, delay),
  });
}

// ─── Worker ───────────────────────────────────────────────────────────────────

const worker =
  globalForQueue.orderDistributionWorker ||
  new Worker(
    "order-distribution",
    async (job) => {
      // ── Legacy "expand-radius" (backward compat, no longer queued) ───────────
      if (job.name === "expand-radius") {
        const { orderId, alertData, farDriverIds } = job.data as any;
        try {
          const order = await prisma.order.findUnique({ where: { id: orderId } });
          if (order?.status !== "pending") return;
          const io = (global as Record<string, unknown>).socketIO as any;
          if (!io) return;
          if (farDriverIds?.length > 0) {
            farDriverIds.forEach((id: number) =>
              io.to(`driver:${id}`).emit("new_order_alert", alertData)
            );
          } else {
            io.to("drivers").emit("new_order_alert", alertData);
          }
        } catch (err) {
          console.error("[dispatch] expand-radius error:", err);
        }
        return;
      }

      // ── New multi-step dispatch ──────────────────────────────────────────────
      if (job.name !== "dispatch-step") return;

      const data = job.data as DispatchStepJobData;
      const { orderId, step, notifiedIds, pickupLat, pickupLng, classId, alertData } = data;

      // 1. Guard: order must still be pending
      let order;
      try {
        order = await prisma.order.findUnique({ where: { id: orderId } });
      } catch (err) {
        console.error(`[dispatch] step=${step} DB error:`, err);
        return;
      }
      if (!order || order.status !== "pending") {
        console.log(`[dispatch] order #${orderId} no longer pending at step ${step} — stopping.`);
        return;
      }

      const io = (global as Record<string, unknown>).socketIO as any;
      if (!io) {
        console.warn("[dispatch] socketIO not available — skipping step", step);
        return;
      }

      // 2. Step 4 → broadcast to ALL drivers (last resort)
      if (step >= 4) {
        console.log(`[dispatch] order #${orderId} step 4 → broadcast ALL`);
        io.to("drivers").emit("new_order_alert", alertData);
        return;
      }

      // 3. Steps 1-3: geo-radius search
      const radius = STEP_RADII[step];
      console.log(`[dispatch] order #${orderId} step ${step} radius ${radius} km`);

      let nearbyMembers: any[] = [];
      try {
        nearbyMembers = (await redis.geoSearchWith(
          "driver_locations",
          { longitude: pickupLng, latitude: pickupLat },
          { radius, unit: "km" },
          ["WITHDIST"],
          { SORT: "ASC" },
        )) as any[];
      } catch (err) {
        console.error("[dispatch] geoSearch error:", err);
        // Geo lookup failed — advance to next step immediately
        await scheduleNextStep(data, 0);
        return;
      }

      // 4. Filter out already-notified drivers
      const notifiedSet = new Set(notifiedIds);
      const newMembers = nearbyMembers.filter(
        (m) => !notifiedSet.has(Number(m.member))
      );

      if (newMembers.length === 0) {
        console.log(`[dispatch] order #${orderId} step ${step}: no new drivers in ${radius} km → advance`);
        await scheduleNextStep(data, 0);
        return;
      }

      // 5. Validate in DB (free, sufficient balance, correct vehicle class)
      const candidateIds = newMembers.map((m) => Number(m.member));
      let validDrivers: { id: number }[] = [];
      try {
        validDrivers = await prisma.driver.findMany({
          where: {
            id: { in: candidateIds },
            status: "free",
            isActive: true,
            balance: { gte: 30 },
            ...(classId
              ? {
                  vehicles: {
                    some: {
                      isActive: true,
                      classes: { some: { classId } },
                    },
                  },
                }
              : {}),
          },
          select: { id: true },
        });
      } catch (err) {
        console.error("[dispatch] DB validation error:", err);
        await scheduleNextStep(data, 0);
        return;
      }

      if (validDrivers.length === 0) {
        console.log(`[dispatch] order #${orderId} step ${step}: no eligible drivers → advance`);
        await scheduleNextStep(data, 0);
        return;
      }

      // 6. Apply level filter + sort (gold → silver → bronze; blocked excluded)
      let levelMap;
      try {
        levelMap = await getDriverLevelMap();
      } catch {
        levelMap = new Map();
      }

      const validSet = new Set(validDrivers.map((d) => d.id));
      const distMap = new Map(
        newMembers.map((m) => [Number(m.member), Number(m.distance || 0)])
      );

      const toNotify = candidateIds
        .filter((id) => validSet.has(id))
        .map((id) => ({
          id,
          dist: distMap.get(id) ?? 999,
          levelPriority: LEVEL_PRIORITY[(levelMap.get(id)?.level ?? "bronze") as import("./driverRanking").DriverLevel],
        }))
        .filter((d) => d.levelPriority < 99) // exclude blocked
        .sort((a, b) =>
          a.levelPriority !== b.levelPriority
            ? a.levelPriority - b.levelPriority // gold first
            : a.dist - b.dist                   // nearest within same level
        );

      if (toNotify.length === 0) {
        console.log(`[dispatch] order #${orderId} step ${step}: all nearby blocked → advance`);
        await scheduleNextStep(data, 0);
        return;
      }

      // 7. Send notifications
      toNotify.forEach((d) =>
        io.to(`driver:${d.id}`).emit("new_order_alert", alertData)
      );
      console.log(
        `[dispatch] order #${orderId} step ${step}: notified ${toNotify.length} driver(s): ` +
        toNotify.map((d) => `#${d.id}(${d.dist.toFixed(1)}km)`).join(", ")
      );

      // 8. Schedule next step after STEP_DELAY_MS
      const allNotified = [
        ...notifiedIds,
        ...toNotify.map((d) => d.id),
      ];
      await scheduleNextStep(
        { ...data, notifiedIds: allNotified },
        jittered(STEP_DELAY_MS),
      );
    },
    { connection },
  );

if (process.env.NODE_ENV !== "production") {
  globalForQueue.orderDistributionWorker = worker;
}

if (worker.listeners("failed").length === 0) {
  worker.on("failed", (job, err) => {
    console.error(`[dispatch] job ${job?.id} failed:`, err);
  });
}
