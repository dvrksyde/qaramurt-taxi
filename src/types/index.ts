// ─── ENUMS ───────────────────────────────────────────────────────────────────

export type DriverStatus = "free" | "busy" | "offline";
export type OrderStatus = "pending" | "assigned" | "arrived" | "in_progress" | "completed" | "canceled";
export type DistributionMethod = "automatic" | "broadcast" | "sequential" | "map_pick" | "list_pick";
export type CallType = "inbound" | "outbound";
export type CallStatus = "answered" | "missed" | "busy" | "failed";
export type TransactionType = "payout" | "deposit" | "penalty" | "bonus";
export type TariffType = "commission" | "fixed" | "unlimited";

// ─── CORE ENTITIES ────────────────────────────────────────────────────────────

export interface Driver {
  id: number;
  callsign: string | null;
  lastName: string;
  firstName: string;
  middleName: string | null;
  phone: string;
  login: string;
  status: DriverStatus;
  balance: number;
  rating: number;
  maxCredit: number;
  currentLocation?: { lat: number; lng: number } | null;
  tariffGroupId: number | null;
  isActive: boolean;
  createdAt: string;
  deviceId?: string | null;
  ordersCount?: number;
  vehicles?: { id: number; plate: string; make: string; model: string; color: string; classes?: any[] }[];
  osVersion?: string | null;
  thirdPartyApps?: string[] | null;
}

export interface DriverLocation {
  driverId: number;
  lat: number;
  lng: number;
  status: DriverStatus;
  callsign?: string | null;
  heading?: number;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  plate?: string | null;
  vehicleLabel?: string | null;
}

export interface Order {
  id: number;
  phone: string;
  clientId: number | null;
  serviceId: number | null;
  driverId: number | null;
  operatorId: number | null;
  tariffId: number | null;
  classId: number | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  stops: Stop[];
  distanceKm: number | null;
  estimatedPrice: number | null;
  finalPrice: number | null;
  distributionMethod: DistributionMethod;
  status: OrderStatus;
  comment: string | null;
  isScheduled: boolean;
  scheduledAt: string | null;
  isUrgent: boolean;
  createdAt: string;
  assignedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  driver?: Driver | null;
  service?: TaxiService | null;
  class?: { id: number; name: string } | null;
}

export interface Stop {
  address: string;
  lat?: number;
  lng?: number;
  order: number;
}

export interface TaxiService {
  id: number;
  name: string;
  priority: number;
  settlement: string | null;
  isActive: boolean;
}

export interface VehicleClass {
  id: number;
  groupId: number;
  name: string;
  isActive: boolean;
}

export interface VehicleClassGroup {
  id: number;
  name: string;
  classes: VehicleClass[];
}

export interface VehicleOption {
  id: number;
  name: string;
  description: string | null;
  priceModifier: number;
}

export interface Tariff {
  id: number;
  serviceId: number;
  classId: number;
  name: string;
  basePrice: number;
  pricePerKm: number;
  pricePerMin: number;
  minPrice: number;
  freeWaitMinutes: number;
  extraWaitPrice: number;
}

export interface Vehicle {
  id: number;
  plate: string;
  make: string;
  model: string;
  color: string;
  year: number | null;
  ownershipType: string;
  driverId: number | null;
  isActive: boolean;
  driver?: Pick<Driver, "id" | "firstName" | "lastName"> | null;
  classes?: VehicleClass[];
}

export interface Operator {
  id: number;
  login: string;
  name: string;
  role: string;
  permissions: string[];
  cashBalance: number;
  advanceBalance: number;
  isActive: boolean;
  isOnline?: boolean;
  lastSeenAt?: string | null;
}

export interface Client {
  id: number;
  phone: string;
  name: string | null;
  bonusBalance: number;
  isBlacklisted: boolean;
  createdAt: string;
}

export interface CallLog {
  id: number;
  timestamp: string;
  phoneFrom: string;
  phoneTo: string;
  callType: CallType;
  operatorId: number | null;
  serviceId: number | null;
  durationTotalSec: number;
  durationWaitSec: number;
  durationTalkSec: number;
  status: CallStatus;
  recordingUrl: string | null;
  operator?: Pick<Operator, "name"> | null;
}

export interface CashTransaction {
  id: number;
  operatorId: number;
  driverId: number | null;
  orderId: number | null;
  type: TransactionType;
  amount: number;
  description: string | null;
  createdAt: string;
}

// ─── FORM TYPES ───────────────────────────────────────────────────────────────

export interface NewOrderFormData {
  phone: string;
  serviceId: number | null;
  clientName: string;
  timing: "now" | "scheduled";
  scheduledAt?: string;
  pickupAddress: string;
  pickupPoint?: [number, number];
  dropoffAddress: string;
  dropoffPoint?: [number, number];
  stops: Stop[];
  comment: string;
  classId: number | null;
  tariffId: number | null;
  cashlessAccountId: number | null;
  useBonuses: boolean;
  estimatedPrice: number | null;
  distributionMethod: DistributionMethod;
  optionIds: number[];
  printReceipt: boolean;
  pricePerKm: string;
  distanceKm?: number;
}

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────────

export interface TabCounts {
  current: number;
  scheduled: number;
  exchange: number;
  chat: number;
  system: number;
  alarms: number;
}

export interface SystemLogEntry {
  id: string;
  message: string;
  level: "info" | "warn" | "error";
  timestamp: string;
}

export interface ChatMessage {
  from: string;
  driverId?: number;
  text: string;
  timestamp: string;
  direction: "inbound" | "outbound";
}

export interface AlarmEvent {
  driverId: number;
  lat: number;
  lng: number;
  message?: string;
  timestamp: string;
}

// ─── API RESPONSE ─────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── BILLING ─────────────────────────────────────────────────────────────────

export interface KassaRow {
  operatorId: number;
  operatorName: string;
  beginTaxiDebt: number;
  beginOperatorCash: number;
  payouts: number;
  deposits: number;
  endTaxiDebt: number;
  endOperatorCash: number;
}
