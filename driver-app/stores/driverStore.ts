import { create } from "zustand";

interface DriverProfile {
  id: number;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  callsign: string | null;
  phone: string;
  login?: string;
  tariffGroup?: { name: string; value: number } | null;
  balance: number;
  rating: number;
  ordersCount?: number;
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
  serviceId?: number | null;
  service?: { id: number; name: string } | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  pickupPoint?: string | null;
  dropoffPoint?: string | null;
  pricePerKm: number;
  status: string;
  distanceKm: number;
  currentPrice: number;
  estimatedPrice: number | null;
  isFixedPrice: boolean;
  startedAt: string | null;
  arrivedAt?: string | null;
  isWaiting?: boolean;
  waitingStartedAt?: string | null;
  waitingAccumulatedSeconds?: number;
  waitingFee?: number;
  options?: string[] | null;
  class?: { id: number; name: string } | null;
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
  tripDistance: number;
  tripPrice: number;
  tripStartTime: number | null;
  lastLocation: { lat: number; lng: number } | null;
  setTripMeter: (d: number, p: number) => void;
  setLastLocation: (loc: { lat: number; lng: number } | null) => void;
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
  lastLocation: null,
  setTripMeter: (tripDistance, tripPrice) => set({ tripDistance, tripPrice }),
  setLastLocation: (lastLocation) => set({ lastLocation }),
  resetTrip: () => set({ tripDistance: 0, tripPrice: 0, tripStartTime: null, lastLocation: null }),
  startTrip: () => set({ tripStartTime: Date.now(), lastLocation: null }),
}));
