import { Queue, Worker } from "bullmq";
import { prisma } from "./prisma";

// We can reuse the REDIS_URL from env
const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
};

const globalForQueue = global as unknown as { 
  orderDistributionQueue: Queue;
  orderDistributionWorker: Worker;
};

export const orderDistributionQueue = 
  globalForQueue.orderDistributionQueue || new Queue("order-distribution", { 
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 1000 // keep last 1000 failed jobs for debugging
    }
  });

if (process.env.NODE_ENV !== "production") {
  globalForQueue.orderDistributionQueue = orderDistributionQueue;
}

// Define the worker that will process the delayed tasks
const worker = globalForQueue.orderDistributionWorker || new Worker("order-distribution", async (job) => {
  if (job.name === "expand-radius") {
    const { orderId, alertData, farDriverIds } = job.data;
    
    try {
      const checkOrder = await prisma.order.findUnique({ where: { id: orderId } });
      if (checkOrder?.status === "pending") {
        const io = (global as Record<string, unknown>).socketIO as any;
        if (io) {
          if (farDriverIds && farDriverIds.length > 0) {
            farDriverIds.forEach((driverId: number) => {
              io.to(`driver:${driverId}`).emit("new_order_alert", alertData);
            });
          } else {
            // No far drivers, broadcast to everyone
            io.to("drivers").emit("new_order_alert", alertData);
          }
        }
      }
    } catch (err) {
      console.error("Worker error checking order", err);
    }
  }
}, { connection });

if (process.env.NODE_ENV !== "production") {
  globalForQueue.orderDistributionWorker = worker;
}

if (worker.listeners('failed').length === 0) {
  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
  });
}
