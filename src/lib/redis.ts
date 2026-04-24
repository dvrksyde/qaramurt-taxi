import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const globalForRedis = global as unknown as { redis: ReturnType<typeof createClient> };

export const redis = globalForRedis.redis || createClient({ url: REDIS_URL });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

// Ensure connection is established
if (!redis.isOpen) {
  redis.connect().catch(console.error);
}

if (redis.listeners("error").length === 0) {
  redis.on("error", (err) => {
    console.error("Redis Client Error:", err);
  });
}

export default redis;
