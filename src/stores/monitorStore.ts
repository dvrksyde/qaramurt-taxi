import { create } from "zustand";
import type { Order, Driver, DriverLocation, TabCounts, ChatMessage, AlarmEvent, SystemLogEntry } from "@/types";

interface MonitorState {
  // Active tab
  activeTab: "current" | "scheduled" | "exchange" | "map" | "chat" | "system" | "alarms";
  setActiveTab: (tab: MonitorState["activeTab"]) => void;

  // Tab counts
  counts: TabCounts;
  setCounts: (counts: Partial<TabCounts>) => void;
  incrementCount: (tab: keyof TabCounts) => void;

  // Orders
  currentOrders: Order[];
  scheduledOrders: Order[];
  setCurrentOrders: (orders: Order[]) => void;
  addOrder: (order: Order) => void;
  updateOrder: (id: number, updates: Partial<Order>) => void;
  removeOrder: (id: number) => void;

  // Driver positions on map
  driverLocations: Record<number, DriverLocation>;
  updateDriverLocation: (loc: DriverLocation) => void;
  setDriverOffline: (driverId: number) => void;

  // Chat
  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  setChatMessages: (msgs: ChatMessage[]) => void;
  chatHistoryLoaded: boolean;
  unreadChat: number;
  clearChatUnread: () => void;
  readChatAt: Record<number, string>; // driverId -> ISO timestamp of last read
  markDriverChatRead: (driverId: number) => void;

  // System log
  systemLog: SystemLogEntry[];
  addSystemLog: (entry: SystemLogEntry) => void;

  // Alarms
  alarms: AlarmEvent[];
  addAlarm: (alarm: AlarmEvent) => void;
  clearAlarms: () => void;

  // Order details modal
  selectedOrderId: number | null;
  setSelectedOrderId: (id: number | null) => void;

  // New order modal
  isNewOrderOpen: boolean;
  openNewOrder: () => void;
  closeNewOrder: () => void;

  // Connection status
  isConnected: boolean;
  setConnected: (v: boolean) => void;

  // Status bar
  totalCash: number;
  advanceBalance: number;
  setStatusBar: (cash: number, advance: number) => void;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  activeTab: "current",
  setActiveTab: (tab) => {
    if (typeof window !== "undefined") localStorage.setItem("monitor_active_tab", tab);
    set({ activeTab: tab });
  },

  counts: { current: 0, scheduled: 0, exchange: 0, chat: 0, system: 0, alarms: 0 },
  setCounts: (counts) => set((s) => ({ counts: { ...s.counts, ...counts } })),
  incrementCount: (tab) =>
    set((s) => ({ counts: { ...s.counts, [tab]: s.counts[tab] + 1 } })),

  currentOrders: [],
  scheduledOrders: [],
  setCurrentOrders: (orders) => set((s) => ({ 
    currentOrders: orders,
    counts: { ...s.counts, current: orders.length }
  })),
  addOrder: (order) =>
    set((s) => {
      if (s.currentOrders.some((o) => o.id === order.id)) return s;
      return {
        currentOrders: [order, ...s.currentOrders],
        counts: { ...s.counts, current: s.counts.current + 1 },
      };
    }),
  updateOrder: (id, updates) =>
    set((s) => ({
      currentOrders: s.currentOrders.map((o) => (o.id === id ? { ...o, ...updates } : o)),
    })),
  removeOrder: (id) =>
    set((s) => ({
      currentOrders: s.currentOrders.filter((o) => o.id !== id),
      counts: { ...s.counts, current: Math.max(0, s.counts.current - 1) },
    })),

  driverLocations: {},
  updateDriverLocation: (loc) =>
    set((s) => ({ driverLocations: { ...s.driverLocations, [loc.driverId]: loc } })),
  setDriverOffline: (driverId) =>
    set((s) => {
      const updated = { ...s.driverLocations };
      if (updated[driverId]) updated[driverId] = { ...updated[driverId], status: "offline" };
      return { driverLocations: updated };
    }),

  chatMessages: [],
  chatHistoryLoaded: false,
  addChatMessage: (msg) =>
    set((s) => {
      const newMessages = [...s.chatMessages, msg];
      // Calculate unread using persisted readChatAt
      const readAt = s.readChatAt;
      const unread = newMessages.filter((m) => {
        if (m.direction !== "inbound" || !m.driverId) return false;
        const readTime = readAt[m.driverId];
        if (!readTime) return true;
        return new Date(m.timestamp) > new Date(readTime);
      }).length;
      return {
        chatMessages: newMessages,
        unreadChat: unread,
        counts: { ...s.counts, chat: unread },
      };
    }),
  setChatMessages: (msgs) =>
    set((s) => {
      const readAt = s.readChatAt;
      const unread = msgs.filter((m) => {
        if (m.direction !== "inbound" || !m.driverId) return false;
        const readTime = readAt[m.driverId];
        if (!readTime) return true;
        return new Date(m.timestamp) > new Date(readTime);
      }).length;
      return {
        chatMessages: msgs,
        chatHistoryLoaded: true,
        unreadChat: unread,
        counts: { ...s.counts, chat: unread },
      };
    }),
  unreadChat: 0,
  clearChatUnread: () => set((s) => ({ unreadChat: 0, counts: { ...s.counts, chat: 0 } })),
  readChatAt: (() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem("chat_read_at");
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  })(),
  markDriverChatRead: (driverId) =>
    set((s) => {
      const newReadAt = { ...s.readChatAt, [driverId]: new Date().toISOString() };
      // Persist to localStorage
      try { localStorage.setItem("chat_read_at", JSON.stringify(newReadAt)); } catch {}
      // Recalculate total unread
      const unread = s.chatMessages.filter((m) => {
        if (m.direction !== "inbound" || !m.driverId) return false;
        const readTime = newReadAt[m.driverId];
        if (!readTime) return true;
        return new Date(m.timestamp) > new Date(readTime);
      }).length;
      return {
        readChatAt: newReadAt,
        unreadChat: unread,
        counts: { ...s.counts, chat: unread },
      };
    }),

  systemLog: [],
  addSystemLog: (entry) =>
    set((s) => ({
      systemLog: [entry, ...s.systemLog].slice(0, 200),
      counts: { ...s.counts, system: s.counts.system + 1 },
    })),

  alarms: [],
  addAlarm: (alarm) =>
    set((s) => ({
      alarms: [alarm, ...s.alarms],
      counts: { ...s.counts, alarms: s.counts.alarms + 1 },
    })),
  clearAlarms: () => set({ alarms: [], counts: { ...useMonitorStore.getState().counts, alarms: 0 } }),

  selectedOrderId: null,
  setSelectedOrderId: (id) => set({ selectedOrderId: id }),

  isNewOrderOpen: false,
  openNewOrder: () => set({ isNewOrderOpen: true }),
  closeNewOrder: () => set({ isNewOrderOpen: false }),

  isConnected: false,
  setConnected: (v) => set({ isConnected: v }),

  totalCash: 0,
  advanceBalance: 100,
  setStatusBar: (totalCash, advanceBalance) => set({ totalCash, advanceBalance }),
}));
