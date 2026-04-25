import { io, Socket } from "socket.io-client";
import { API_BASE, getToken } from "./api";

let socket: Socket | null = null;

export function connectSocket(driverId: number) {
  if (socket?.connected) return socket;

  // Reuse disconnected socket instead of creating a new one
  if (socket && !socket.connected) {
    socket.connect();
    return socket;
  }

  socket = io(API_BASE, {
    path: "/api/socket",
    transports: ["websocket"],
    auth: { token: getToken() },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
    timeout: 20000,
  });

  socket.on("connect", () => {
    console.log("[Socket] Connected:", socket?.id);
    socket?.emit("driver_connect", driverId);
  });

  socket.on("disconnect", () => {
    console.log("[Socket] Disconnected");
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
