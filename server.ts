import { createServer } from "http";
import { parse } from "url";

import next from "next";
import { decode } from "next-auth/jwt";
import { createClient } from "redis";
import { Server as SocketIOServer, Socket } from "socket.io";

import { verifyDriverTokenString } from "./src/lib/driverAuth";
import { getPrisma } from "./src/lib/prisma";
import "./src/lib/queue"; // Start BullMQ worker

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// Redis clients for pub/sub — optional (app still works without Redis)
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const redisPub = createClient({ url: REDIS_URL });
const redisSub = createClient({ url: REDIS_URL });

let redisAvailable = false;

redisPub.on("error", () => {});
redisSub.on("error", () => {});

interface DriverLocation {
  driverId: number;
  lat: number;
  lng: number;
  status: string;
  callsign?: string;
}

interface OrderAlert {
  orderId: number;
  method: string;
  targetDriverId?: number;
  classId?: number;
}

interface OperatorSocketAuth {
  kind: "operator";
  operatorId: number;
  role: string;
  permissions: string[];
}

interface DriverSocketAuth {
  kind: "driver";
  driverId: number;
  login: string;
}

type SocketAuth = OperatorSocketAuth | DriverSocketAuth;

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, pair) => {
    const index = pair.indexOf("=");
    if (index === -1) return acc;

    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

async function getOperatorSocketAuth(socket: Socket): Promise<OperatorSocketAuth | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  const cookies = parseCookies(socket.handshake.headers.cookie);
  const sessionToken =
    cookies["__Secure-next-auth.session-token"] ||
    cookies["next-auth.session-token"];

  if (!sessionToken) return null;

  const token = await decode({ token: sessionToken, secret });
  if (!token?.operatorId) return null;

  const permissions = Array.isArray(token.permissions)
    ? token.permissions.filter((value): value is string => typeof value === "string")
    : [];

  return {
    kind: "operator",
    operatorId: Number(token.operatorId),
    role: typeof token.role === "string" ? token.role : "operator",
    permissions,
  };
}

function getDriverSocketAuth(socket: Socket): DriverSocketAuth | null {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string" || !token) return null;

  const payload = verifyDriverTokenString(token);
  if (!payload) return null;

  return {
    kind: "driver",
    driverId: payload.driverId,
    login: payload.login,
  };
}

function hasOperatorPermission(socket: Socket, permission: string): boolean {
  const auth = socket.data.auth as SocketAuth | undefined;
  if (!auth || auth.kind !== "operator") return false;
  return auth.role === "admin" || auth.permissions.includes(permission);
}

// Safe redis publish — no-op if Redis is unavailable
async function safePub(channel: string, data: unknown) {
  if (!redisAvailable) return;
  try {
    await redisPub.publish(channel, JSON.stringify(data));
  } catch {
    // ignore pub/sub issues when app is otherwise healthy
  }
}

app.prepare().then(async () => {
  try {
    await Promise.race([
      Promise.all([redisPub.connect(), redisSub.connect()]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    redisAvailable = true;
    console.log("> Redis connected:", REDIS_URL);
  } catch {
    console.warn("> Redis unavailable — running without pub/sub (Socket.io still works via in-process)");
    redisPub.quit().catch(() => {});
    redisSub.quit().catch(() => {});
  }

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(httpServer, {
    path: "/api/socket",
    cors: {
      origin: process.env.SOCKET_CORS_ORIGIN
        ? process.env.SOCKET_CORS_ORIGIN.split(",")
        : "*",
      methods: ["GET", "POST"],
    },
  });

  io.use(async (socket, next) => {
    const operatorAuth = await getOperatorSocketAuth(socket);
    if (operatorAuth) {
      socket.data.auth = operatorAuth;
      return next();
    }

    const driverAuth = getDriverSocketAuth(socket);
    if (driverAuth) {
      socket.data.auth = driverAuth;
      return next();
    }

    next(new Error("Unauthorized socket connection"));
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on("join_monitor", () => {
      const auth = socket.data.auth as SocketAuth | undefined;
      if (auth?.kind !== "operator") return;

      socket.join("monitor");
      console.log(`[Socket] ${socket.id} joined monitor`);
    });

    socket.on("driver_connect", (driverId: number) => {
      const auth = socket.data.auth as SocketAuth | undefined;
      if (auth?.kind !== "driver" || auth.driverId !== driverId) return;

      socket.join("drivers");
      socket.join(`driver:${driverId}`);
      socket.data.driverId = driverId;
      console.log(`[Socket] Driver ${driverId} connected`);
      io.to("monitor").emit("driver_online", { driverId, socketId: socket.id });
    });

    socket.on("driver_location_update", async (data: DriverLocation) => {
      const auth = socket.data.auth as SocketAuth | undefined;
      if (auth?.kind !== "driver" || auth.driverId !== data.driverId) return;

      io.to("monitor").emit("driver_location_update", data);
      await safePub("driver_location", data);
    });

    socket.on("dispatch_order", async (alert: OrderAlert) => {
      if (!hasOperatorPermission(socket, "current_orders")) return;

      if (alert.method === "broadcast") {
        io.to("drivers").emit("new_order_alert", alert);
      } else if (alert.targetDriverId) {
        io.to(`driver:${alert.targetDriverId}`).emit("new_order_alert", alert);
      }

      io.to("monitor").emit("order_updated", { orderId: alert.orderId, method: alert.method });
      await safePub("order_dispatch", alert);
    });

    socket.on("driver_accept_order", (data: { orderId: number; driverId: number }) => {
      const auth = socket.data.auth as SocketAuth | undefined;
      if (auth?.kind !== "driver" || auth.driverId !== data.driverId) return;

      io.to("monitor").emit("order_status_change", {
        orderId: data.orderId,
        status: "assigned",
        driverId: data.driverId,
      });
    });

    socket.on("order_status_update", (data: { orderId: number; status: string; driverId: number }) => {
      const auth = socket.data.auth as SocketAuth | undefined;
      if (auth?.kind !== "driver" || auth.driverId !== data.driverId) return;

      io.to("monitor").emit("order_status_change", data);
    });

    socket.on("chat_message", async (msg: { from: string; driverId?: number; text: string; timestamp: string }) => {
      const auth = socket.data.auth as SocketAuth | undefined;
      if (!auth) return;

      try {
        const prisma = getPrisma();

        if (auth.kind === "operator") {
          // Save to DB
          await prisma.chatMessage.create({
            data: {
              from: msg.from || "Оператор",
              driverId: msg.driverId || null,
              text: msg.text,
              direction: "outbound",
            },
          });

          const safeMessage = {
            ...msg,
            from: msg.from || "Оператор",
            direction: "outbound" as const,
          };

          // Send to other monitors (excluding sender)
          socket.broadcast.to("monitor").emit("chat_message", safeMessage);

          // Send to target driver (they see it as inbound)
          if (msg.driverId) {
            io.to(`driver:${msg.driverId}`).emit("chat_message", {
              ...safeMessage,
              direction: "inbound",
            });
          } else {
            // Broadcast to all drivers
            io.to("drivers").emit("chat_message", {
              ...safeMessage,
              direction: "inbound",
            });
          }
          return;
        }

        // Driver sending message — look up driver name
        let driverName = msg.from;
        try {
          const driver = await prisma.driver.findUnique({
            where: { id: auth.driverId },
            select: { callsign: true, firstName: true, lastName: true },
          });
          if (driver) {
            driverName = `${driver.callsign || ""} ${driver.lastName} ${driver.firstName}`.trim();
          }
        } catch { }

        // Save to DB
        await prisma.chatMessage.create({
          data: {
            from: driverName,
            driverId: auth.driverId,
            text: msg.text,
            direction: "inbound",
          },
        });

        const safeMessage = {
          ...msg,
          from: driverName,
          driverId: auth.driverId,
          direction: "inbound" as const,
        };

        // Send to monitor (dispatchers see it as inbound from driver)
        io.to("monitor").emit("chat_message", safeMessage);

        // Don't echo back to the driver
      } catch (err) {
        console.error("[Chat] Error:", err);
      }
    });

    socket.on("driver_alarm", (data: { driverId: number; lat: number; lng: number; message?: string }) => {
      const auth = socket.data.auth as SocketAuth | undefined;
      if (auth?.kind !== "driver" || auth.driverId !== data.driverId) return;

      io.to("monitor").emit("driver_alarm", { ...data, timestamp: new Date().toISOString() });
      console.log(`[ALARM] Driver ${data.driverId} triggered emergency!`);
    });

    socket.on("request_counts", () => {
      const auth = socket.data.auth as SocketAuth | undefined;
      if (auth?.kind !== "operator") return;

      socket.emit("tab_counts", { current: 0, chat: 0, system: 0 });
    });

    socket.on("disconnect", () => {
      const driverId = socket.data.driverId;
      if (driverId) {
        io.to("monitor").emit("driver_offline", { driverId });
      }
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  if (redisAvailable) {
    await redisSub.subscribe("driver_location", (message) => {
      const data = JSON.parse(message);
      io.to("monitor").emit("driver_location_update", data);
    });
    await redisSub.subscribe("order_dispatch", (message) => {
      const data = JSON.parse(message);
      io.to("monitor").emit("order_updated", data);
    });
  }

  (global as Record<string, unknown>).socketIO = io;

  const PORT = parseInt(process.env.PORT || "3000", 10);
  const HOST = "0.0.0.0";
  httpServer.listen(PORT, HOST, () => {
    console.log(`> Qaramurt Taxi ready on http://localhost:${PORT} (network: http://${HOST}:${PORT})`);
    console.log(`> Socket.io running on /api/socket`);
    console.log(`> Redis: ${redisAvailable ? "connected" : "offline (degraded mode)"}`);
    console.log(`> Environment: ${dev ? "development" : "production"}`);
  });
});
