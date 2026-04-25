import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const globalForRedis = global as unknown as { redis: ReturnType<typeof createClient> };

export const redis = globalForRedis.redis || createClient({ url: REDIS_URL });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

// Ensure connection is established
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

if (!redis.isOpen && !isBuildPhase) {
  redis.connect().catch((err) => {
    // Only log if not in build phase to avoid spam
    if (!isBuildPhase) {
      console.error("Redis connection error:", err);
    }
  });
}

if (redis.listeners("error").length === 0) {
  redis.on("error", (err) => {
    // During build, connection errors are expected if Redis is local
    if (!isBuildPhase) {
      console.error("Redis Client Error:", err);
    }
  });
}

export default redis;
