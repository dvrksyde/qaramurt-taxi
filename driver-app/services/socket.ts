import { io, Socket } from "socket.io-client";
import { API_BASE, getToken } from "./api";

let socket: Socket | null = null;
let currentDriverId: number | null = null;

export function connectSocket(driverId: number) {
  currentDriverId = driverId;

  if (socket) {
    socket.auth = { token: getToken() };

    // Reuse the same singleton socket even while it is reconnecting.
    // Creating a fresh instance here multiplies listeners and duplicate alerts.
    if (!socket.connected) {
      socket.connect();
    }

    return socket;
  }

  socket = io(API_BASE, {
    path: "/api/socket",
    transports: ["websocket"],
    auth: { token: getToken() },
  });

  socket.on("connect", () => {
    console.log("[Socket] Connected:", socket?.id);
    if (currentDriverId) {
      socket?.emit("driver_connect", currentDriverId);
    }
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
  currentDriverId = null;
}
