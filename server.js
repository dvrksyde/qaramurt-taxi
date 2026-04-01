"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const url_1 = require("url");
const next_1 = __importDefault(require("next"));
const jwt_1 = require("next-auth/jwt");
const redis_1 = require("redis");
const socket_io_1 = require("socket.io");
const driverAuth_1 = require("./src/lib/driverAuth");
const dev = process.env.NODE_ENV !== "production";
const app = (0, next_1.default)({ dev });
const handle = app.getRequestHandler();
// Redis clients for pub/sub — optional (app still works without Redis)
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const redisPub = (0, redis_1.createClient)({ url: REDIS_URL });
const redisSub = (0, redis_1.createClient)({ url: REDIS_URL });
let redisAvailable = false;
redisPub.on("error", () => { });
redisSub.on("error", () => { });
function parseCookies(cookieHeader) {
    if (!cookieHeader)
        return {};
    return cookieHeader.split(";").reduce((acc, pair) => {
        const index = pair.indexOf("=");
        if (index === -1)
            return acc;
        const key = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        acc[key] = decodeURIComponent(value);
        return acc;
    }, {});
}
async function getOperatorSocketAuth(socket) {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret)
        return null;
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const sessionToken = cookies["__Secure-next-auth.session-token"] ||
        cookies["next-auth.session-token"];
    if (!sessionToken)
        return null;
    const token = await (0, jwt_1.decode)({ token: sessionToken, secret });
    if (!token?.operatorId)
        return null;
    const permissions = Array.isArray(token.permissions)
        ? token.permissions.filter((value) => typeof value === "string")
        : [];
    return {
        kind: "operator",
        operatorId: Number(token.operatorId),
        role: typeof token.role === "string" ? token.role : "operator",
        permissions,
    };
}
function getDriverSocketAuth(socket) {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token)
        return null;
    const payload = (0, driverAuth_1.verifyDriverTokenString)(token);
    if (!payload)
        return null;
    return {
        kind: "driver",
        driverId: payload.driverId,
        login: payload.login,
    };
}
function hasOperatorPermission(socket, permission) {
    const auth = socket.data.auth;
    if (!auth || auth.kind !== "operator")
        return false;
    return auth.role === "admin" || auth.permissions.includes(permission);
}
// Safe redis publish — no-op if Redis is unavailable
async function safePub(channel, data) {
    if (!redisAvailable)
        return;
    try {
        await redisPub.publish(channel, JSON.stringify(data));
    }
    catch {
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
    }
    catch {
        console.warn("> Redis unavailable — running without pub/sub (Socket.io still works via in-process)");
        redisPub.quit().catch(() => { });
        redisSub.quit().catch(() => { });
    }
    const httpServer = (0, http_1.createServer)((req, res) => {
        const parsedUrl = (0, url_1.parse)(req.url, true);
        handle(req, res, parsedUrl);
    });
    const io = new socket_io_1.Server(httpServer, {
        path: "/api/socket",
        cors: {
            origin: process.env.NEXTAUTH_URL || "http://localhost:3000",
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
            const auth = socket.data.auth;
            if (auth?.kind !== "operator")
                return;
            socket.join("monitor");
            console.log(`[Socket] ${socket.id} joined monitor`);
        });
        socket.on("driver_connect", (driverId) => {
            const auth = socket.data.auth;
            if (auth?.kind !== "driver" || auth.driverId !== driverId)
                return;
            socket.join("drivers");
            socket.join(`driver:${driverId}`);
            socket.data.driverId = driverId;
            console.log(`[Socket] Driver ${driverId} connected`);
            io.to("monitor").emit("driver_online", { driverId, socketId: socket.id });
        });
        socket.on("driver_location_update", async (data) => {
            const auth = socket.data.auth;
            if (auth?.kind !== "driver" || auth.driverId !== data.driverId)
                return;
            io.to("monitor").emit("driver_location_update", data);
            await safePub("driver_location", data);
        });
        socket.on("dispatch_order", async (alert) => {
            if (!hasOperatorPermission(socket, "current_orders"))
                return;
            if (alert.method === "broadcast") {
                io.to("drivers").emit("new_order_alert", alert);
            }
            else if (alert.targetDriverId) {
                io.to(`driver:${alert.targetDriverId}`).emit("new_order_alert", alert);
            }
            io.to("monitor").emit("order_updated", { orderId: alert.orderId, method: alert.method });
            await safePub("order_dispatch", alert);
        });
        socket.on("driver_accept_order", (data) => {
            const auth = socket.data.auth;
            if (auth?.kind !== "driver" || auth.driverId !== data.driverId)
                return;
            io.to("monitor").emit("order_status_change", {
                orderId: data.orderId,
                status: "assigned",
                driverId: data.driverId,
            });
        });
        socket.on("order_status_update", (data) => {
            const auth = socket.data.auth;
            if (auth?.kind !== "driver" || auth.driverId !== data.driverId)
                return;
            io.to("monitor").emit("order_status_change", data);
        });
        socket.on("chat_message", (msg) => {
            const auth = socket.data.auth;
            if (!auth)
                return;
            if (auth.kind === "operator") {
                const safeMessage = {
                    ...msg,
                    from: msg.from || `Operator #${auth.operatorId}`,
                };
                io.to("monitor").emit("chat_message", safeMessage);
                if (msg.driverId) {
                    io.to(`driver:${msg.driverId}`).emit("chat_message", safeMessage);
                }
                return;
            }
            const safeMessage = {
                ...msg,
                driverId: auth.driverId,
            };
            io.to("monitor").emit("chat_message", safeMessage);
            io.to(`driver:${auth.driverId}`).emit("chat_message", safeMessage);
        });
        socket.on("driver_alarm", (data) => {
            const auth = socket.data.auth;
            if (auth?.kind !== "driver" || auth.driverId !== data.driverId)
                return;
            io.to("monitor").emit("driver_alarm", { ...data, timestamp: new Date().toISOString() });
            console.log(`[ALARM] Driver ${data.driverId} triggered emergency!`);
        });
        socket.on("request_counts", () => {
            const auth = socket.data.auth;
            if (auth?.kind !== "operator")
                return;
            socket.emit("tab_counts", { current: 0, scheduled: 0, exchange: 0, chat: 0, system: 0, alarms: 0 });
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
    global.socketIO = io;
    const PORT = parseInt(process.env.PORT || "3000", 10);
    httpServer.listen(PORT, () => {
        console.log(`> Qaramurt Taxi ready on http://localhost:${PORT}`);
        console.log(`> Socket.io running on /api/socket`);
        console.log(`> Redis: ${redisAvailable ? "connected" : "offline (degraded mode)"}`);
        console.log(`> Environment: ${dev ? "development" : "production"}`);
    });
});
