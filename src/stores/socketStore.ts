"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useMonitorStore } from "@/stores/monitorStore";

let socketInstance: Socket | null = null;

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const store = useMonitorStore();

  useEffect(() => {
    if (socketInstance) {
      socketRef.current = socketInstance;
      setConnected(socketInstance.connected);
      return;
    }

    const socket = io({
      path: "/api/socket",
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketInstance = socket;
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      store.setConnected(true);
      socket.emit("join_monitor");
      socket.emit("request_counts");

      store.addSystemLog({
        id: Date.now().toString(),
        message: "Connected to dispatch server",
        level: "info",
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("disconnect", () => {
      setConnected(false);
      store.setConnected(false);
    });

    // ── Real-time event handlers ──────────────────────────────────────────

    socket.on("driver_location_update", (data) => {
      store.updateDriverLocation(data);
    });

    socket.on("driver_online", (data) => {
      store.addSystemLog({
        id: Date.now().toString(),
        message: `Driver #${data.driverId} came online`,
        level: "info",
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("driver_offline", (data) => {
      store.setDriverOffline(data.driverId);
      store.addSystemLog({
        id: Date.now().toString(),
        message: `Driver #${data.driverId} went offline`,
        level: "warn",
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("order_updated", (data) => {
      store.addSystemLog({
        id: Date.now().toString(),
        message: `Order #${data.orderId} updated`,
        level: "info",
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("new_order", (order) => {
      // Protect against duplicates
      const current = useMonitorStore.getState().currentOrders;
      if (!current.some((o) => o.id === order.id)) {
        store.addOrder(order);
      }
      store.addSystemLog({
        id: Date.now().toString(),
        message: `Новый заказ #${order.id}`,
        level: "info",
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("order_status_change", (data) => {
      store.updateOrder(data.orderId, { status: data.status, driverId: data.driverId });
    });

    socket.on("chat_message", (msg) => {
      store.addChatMessage(msg);
    });

    socket.on("driver_alarm", (data) => {
      store.addAlarm(data);
    });

    socket.on("tab_counts", (counts) => {
      store.setCounts(counts);
    });

    return () => {
      // Don't disconnect on component unmount — keep singleton
    };
  }, []);

  const dispatchOrder = (alert: {
    orderId: number;
    method: string;
    targetDriverId?: number;
    classId?: number;
  }) => {
    socketRef.current?.emit("dispatch_order", alert);
  };

  const sendChatMessage = (text: string, driverId?: number) => {
    const msg = {
      from: "Dispatcher",
      driverId,
      text,
      timestamp: new Date().toISOString(),
      direction: "outbound" as const,
    };
    socketRef.current?.emit("chat_message", msg);
    store.addChatMessage(msg);
  };

  return { connected, socket: socketRef.current, dispatchOrder, sendChatMessage };
}
