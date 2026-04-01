import { create } from "zustand";

interface DriverProfile {
  id: number;
  firstName: string;
  lastName: string;
  callsign: string | null;
  phone: string;
  balance: number;
  rating: number;
  status: "free" | "busy" | "offline";
  vehicle: any | null;
  todayOrders: number;
  todayEarnings: number;
}

interface OrderAlert {
  orderId: number;
  phone: string;
  pickupAddress: string | null;
  classId: number | null;
  pricePerKm: number;
  createdAt: string;
}

interface ActiveOrder {
  id: number;
  phone: string;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  pricePerKm: number;
  status: string;
  distanceKm: number;
  currentPrice: number;
  startedAt: string | null;
}

interface DriverState {
  profile: DriverProfile | null;
  setProfile: (p: DriverProfile | null) => void;

  isOnline: boolean;
  setOnline: (v: boolean) => void;

  orderAlert: OrderAlert | null;
  setOrderAlert: (a: OrderAlert | null) => void;

  activeOrder: ActiveOrder | null;
  setActiveOrder: (o: ActiveOrder | null) => void;

  // Trip meter
  tripDistance: number;
  tripPrice: number;
  tripStartTime: number | null;
  setTripMeter: (d: number, p: number) => void;
  resetTrip: () => void;
  startTrip: () => void;
}

export const useDriverStore = create<DriverState>((set) => ({
  profile: null,
  setProfile: (profile) => set({ profile }),

  isOnline: false,
  setOnline: (isOnline) => set({ isOnline }),

  orderAlert: null,
  setOrderAlert: (orderAlert) => set({ orderAlert }),

  activeOrder: null,
  setActiveOrder: (activeOrder) => set({ activeOrder }),

  tripDistance: 0,
  tripPrice: 0,
  tripStartTime: null,
  setTripMeter: (tripDistance, tripPrice) => set({ tripDistance, tripPrice }),
  resetTrip: () => set({ tripDistance: 0, tripPrice: 0, tripStartTime: null }),
  startTrip: () => set({ tripStartTime: Date.now() }),
}));
