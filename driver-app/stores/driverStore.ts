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
  assignedAt?: string | null;
  options?: any[] | null;
  class?: { id: number; name: string } | null;
  isWaiting?: boolean;
  waitingStartedAt?: string | null;
  waitingAccumulatedSeconds?: number;
  waitingFee?: number;
  comment?: string | null;
}

interface DriverState {
  profile: DriverProfile | null;
  setProfile: (p: DriverProfile | null) => void;
  isOnline: boolean;
  setOnline: (v: boolean) => void;
  orderAlert: OrderAlert | null;
  setOrderAlert: (a: OrderAlert | null) => void;
  orderQueue: OrderAlert[];
  enqueueOrderAlert: (a: OrderAlert) => void;
  dequeueOrderAlert: () => void;
  clearOrderQueue: () => void;
  removeOrderFromQueue: (orderId: number) => void;
  activeOrder: ActiveOrder | null;
  setActiveOrder: (o: ActiveOrder | null) => void;
  tripDistance: number;
  tripPrice: number;
  tripBaseFare: number;
  tripCityRatePerKm: number;   // server-resolved city rate (correct for "Любой" orders)
  tripStartTime: number | null;
  lastLocation: { lat: number; lng: number } | null;
  lastHeading: number | null;
  setLastHeading: (heading: number | null) => void;
  // Zone tracking
  isOutOfCity: boolean;
  outOfCityRatePerKm: number;
  outOfCityStartTime: number | null;
  tripPriceAtZoneChange: number;
  tripDistanceAtZoneChange: number;
  setTripMeter: (d: number, p: number) => void;
  setTripBaseFare: (fare: number) => void;
  setTripCityRate: (rate: number) => void;
  setLastLocation: (loc: { lat: number; lng: number } | null) => void;
  setZoneChange: (p: { isOutOfCity: boolean; outOfCityRatePerKm: number; currentPrice: number; currentDistance: number }) => void;
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
  orderQueue: [],
  enqueueOrderAlert: (orderAlert) => set((state) => {
    if (state.orderAlert?.orderId === orderAlert.orderId) return state;
    if (state.orderQueue.some(o => o.orderId === orderAlert.orderId)) return state;
    return { orderQueue: [...state.orderQueue, orderAlert] };
  }),
  dequeueOrderAlert: () => set((state) => {
    if (state.orderQueue.length === 0) return { orderAlert: null };
    const [next, ...rest] = state.orderQueue;
    return { orderAlert: next, orderQueue: rest };
  }),
  clearOrderQueue: () => set({ orderQueue: [], orderAlert: null }),
  removeOrderFromQueue: (orderId) => set((state) => ({
    orderQueue: state.orderQueue.filter(o => o.orderId !== orderId)
  })),
  activeOrder: null,
  setActiveOrder: (activeOrder) => set({ activeOrder }),
  tripDistance: 0,
  tripPrice: 0,
  tripBaseFare: 0,
  tripCityRatePerKm: 80,
  tripStartTime: null,
  lastLocation: null,
  lastHeading: null,
  isOutOfCity: false,
  outOfCityRatePerKm: 0,
  outOfCityStartTime: null,
  tripPriceAtZoneChange: 0,
  tripDistanceAtZoneChange: 0,
  setTripMeter: (tripDistance, tripPrice) => set({ tripDistance, tripPrice }),
  setTripBaseFare: (tripBaseFare) => set({ tripBaseFare }),
  setTripCityRate: (tripCityRatePerKm) => set({ tripCityRatePerKm }),
  setLastLocation: (lastLocation) => set({ lastLocation }),
  setLastHeading: (lastHeading) => set({ lastHeading }),
  setZoneChange: ({ isOutOfCity, outOfCityRatePerKm, currentPrice, currentDistance }) => set({
    isOutOfCity,
    outOfCityRatePerKm,
    outOfCityStartTime: isOutOfCity ? Date.now() : null,
    tripPriceAtZoneChange: currentPrice,
    tripDistanceAtZoneChange: currentDistance,
  }),
  resetTrip: () => set({
    tripDistance: 0, tripPrice: 0, tripBaseFare: 0, tripCityRatePerKm: 80,
    tripStartTime: null, lastLocation: null, lastHeading: null,
    isOutOfCity: false, outOfCityRatePerKm: 0, outOfCityStartTime: null,
    tripPriceAtZoneChange: 0, tripDistanceAtZoneChange: 0,
  }),
  startTrip: () => set({ tripStartTime: Date.now(), lastLocation: null }),
}));
