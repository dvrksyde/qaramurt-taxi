import { useEffect, useCallback, useRef, useState } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  Linking,
  Vibration,
  AppState,
  ActivityIndicator,
  Platform,
  BackHandler,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, clearToken, API_BASE } from "../services/api";
import { connectSocket, disconnectSocket, getSocket } from "../services/socket";
import { useDriverStore } from "../stores/driverStore";
import { Audio } from "expo-av";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { registerForPushNotifications, showOrderNotification } from "../services/notifications";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DriverHistoryPanel } from "../components/DriverHistoryPanel";
import { DriverChatPanel } from "../components/DriverChatPanel";
import { DriverProfilePanel } from "../components/DriverProfilePanel";
import { ActiveOrdersPanel } from "../components/ActiveOrdersPanel";
import { SwipeButton } from "../components/SwipeButton";
import { YandexMapView, type YandexMapViewHandle } from "../components/OSMMapView";
import { mapOrderToActiveOrder } from "../lib/orderPricing";
import { clearTripSync, flushTripPoints, getTripRates, getTripPointsForMatching, injectSessionId, queueTripPoint, savePendingCompletion, savePendingStatus, clearPendingStatus, syncPendingStatus, startTripSync, syncPendingCompletion, saveTripMetrics, loadTripMetrics, clearTripMetrics } from "../services/tripSync";
import { initGraphHopper, matchTripPoints } from "../services/graphHopper";
import { processGpsPoint, resetOdometer } from "../services/gpsOdometer";

const BASE_FARE = 290;

/**
 * Resolve the correct base fare using two-priority rules:
 *  1. If the order has a specific named class (not "Любой") → use that class's fare.
 *  2. "Any class" or no class → use the driver's highest vehicle class.
 *     Comfort ≥ Econom: if driver has Comfort (among others) → 390, else → 290.
 *
 * `vehicleClasses` comes from profile.vehicle.classes — each element has
 * { classId, class: { id, name, ... } } (Prisma include of the VehicleClass join row).
 */
function resolveBaseFare(
  orderClass: { name?: string | null } | null | undefined,
  vehicleClasses: Array<{ class?: { name?: string | null } | null }> | null | undefined
): number {
  // Rule 1: order specifies a concrete class
  if (orderClass?.name && orderClass.name !== "Любой") {
    return orderClass.name === "Комфорт" ? 390 : BASE_FARE;
  }
  // Rule 2: "any class" → pick the driver's best class
  const classes = vehicleClasses ?? [];
  const hasComfort = classes.some((c) => c.class?.name === "Комфорт");
  return hasComfort ? 390 : BASE_FARE;
}
type DriverTab = "home" | "orders" | "history" | "chat" | "profile";

function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

function parseWktPoint(point?: string | null) {
  if (!point) return null;
  const match = point.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/i);
  if (!match) return null;
  return {
    latitude: Number(match[2]),
    longitude: Number(match[1]),
  };
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ray-casting point-in-polygon. polygon is [[lng, lat], ...] (GeoJSON order).
 * Runs synchronously in the GPS background task — no async needed.
 */
function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]; // GeoJSON: [lng, lat]
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

const LOCATION_TASK_NAME = "background-location-task";

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error("BG Task Error:", error);
    return;
  }
  if (!data) return;
  try {
    const { locations } = data as { locations: Location.LocationObject[] };
    if (!locations || locations.length === 0) return;

    // Обрабатываем ВСЕ точки из пачки, не только первую
    for (const loc of locations) {
      const { latitude: lat, longitude: lng } = loc.coords;

      // Отбрасываем невалидные координаты (GPS ещё не поймал сигнал)
      if (
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        (lat === 0 && lng === 0) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180
      ) {
        continue;
      }

      const state = useDriverStore.getState();

      // Smoothed coords are set inside the odometer block and used later for queueTripPoint
      let smoothedLat: number | null = null;
      let smoothedLng: number | null = null;

      if (state.activeOrder?.status === "in_progress" && !state.activeOrder.isFixedPrice && !state.activeOrder.isWaiting) {
        // ── Smart GPS Odometer (Kalman filtered) ─────────────────────────────
        const accuracyM = typeof loc.coords.accuracy === "number" && Number.isFinite(loc.coords.accuracy)
          ? loc.coords.accuracy : null;
        const speedMs = typeof loc.coords.speed === "number" && Number.isFinite(loc.coords.speed)
          ? loc.coords.speed : null;

        const gpsResult = processGpsPoint(lat, lng, accuracyM, speedMs, loc.timestamp);
        const d = gpsResult.d;
        smoothedLat = gpsResult.smoothedLat;
        smoothedLng = gpsResult.smoothedLng;

        if (d > 0) {
          const newDist = state.tripDistance + d;
          const cityRate = state.tripCityRatePerKm || Number(state.activeOrder.pricePerKm) || 80;

          // Accumulate out-of-city km while in out-of-city zone
          const updatedOutKm = state.isOutOfCity
            ? state.outOfCityAccumulatedKm + d
            : state.outOfCityAccumulatedKm;

          const cityKm = Math.max(0, newDist - updatedOutKm);
          const outRate = state.outOfCityRatePerKm || cityRate;
          const baseFare = state.tripBaseFare || resolveBaseFare(
            state.activeOrder?.class,
            state.profile?.vehicle?.classes
          );
          const newPrice = roundTo5(baseFare + cityKm * cityRate + updatedOutKm * outRate);

          useDriverStore.setState({
            tripDistance: newDist,
            tripPrice: newPrice,
            outOfCityAccumulatedKm: updatedOutKm,
          });

          // Persist so counter survives app kill (e.g. when driver opens Yandex Navigator)
          void saveTripMetrics({
            orderId: state.activeOrder.id,
            tripDistance: newDist,
            tripPrice: newPrice,
            outOfCityKm: updatedOutKm,
            outOfCitySeconds: useDriverStore.getState().outOfCityAccumulatedSeconds,
            savedAt: Date.now(),
          });
        }

        // ── Client-side zone detection ────────────────────────────────────────
        // Primary mechanism: runs locally using cached GeoJSON polygon.
        // Fixes PostGIS zone detection failing silently (which caused 770₸ instead
        // of 945₸ and missing +25₸/min for out-of-city trips).
        const freshState = useDriverStore.getState();
        const boundary = freshState.cityBoundary;
        if (boundary && boundary.length > 2) {
          const insideCity = pointInPolygon(lat, lng, boundary);
          const nowOutOfCity = !insideCity;
          if (nowOutOfCity !== freshState.isOutOfCity) {
            const outRate = freshState.configuredOutOfCityRate > 0
              ? freshState.configuredOutOfCityRate
              : (freshState.profile?.vehicle?.classes?.some((c: any) => c.class?.name === "Комфорт") ? 140 : 120);
            freshState.setZoneChange({
              isOutOfCity: nowOutOfCity,
              outOfCityRatePerKm: outRate,
              currentPrice: freshState.tripPrice,
              currentDistance: freshState.tripDistance,
            });
          }
        }
        // ─────────────────────────────────────────────────────────────────────
      }

      // Обновляем lastLocation (и heading) после каждой точки из пачки
      useDriverStore.getState().setLastLocation({ lat, lng });
      if (
        typeof loc.coords.heading === "number" &&
        Number.isFinite(loc.coords.heading) &&
        loc.coords.heading >= 0
      ) {
        useDriverStore.getState().setLastHeading(loc.coords.heading);
      }

      // Отправляем сглаженную (Kalman) точку на сервер — не сырую GPS.
      // smoothedLat/Lng = null если точность плохая (accuracy > 50м) → не отправляем.
      if (state.activeOrder?.status === "in_progress" && !state.activeOrder.isFixedPrice) {
        if (smoothedLat !== null && smoothedLng !== null) {
          void queueTripPoint(state.activeOrder.id, {
            lat: smoothedLat,
            lng: smoothedLng,
            capturedAt: new Date(loc.timestamp).toISOString(),
            accuracyM: typeof loc.coords.accuracy === "number" ? loc.coords.accuracy : null,
            speedKmh:
              typeof loc.coords.speed === "number" && Number.isFinite(loc.coords.speed)
                ? loc.coords.speed * 3.6
                : null,
            headingDeg:
              typeof loc.coords.heading === "number" && Number.isFinite(loc.coords.heading)
                ? loc.coords.heading
                : null,
          });
        }
      }

      // Отправляем только последнюю точку из батча — сервер сам rate-limit-ит (3 сек)
      // Для промежуточных точек достаточно trip-трекинга выше
      if (loc === locations[locations.length - 1]) {
        api("/api/driver/location", {
          method: "POST",
          body: JSON.stringify({ lat, lng }),
        }).catch(() => { });
      }
    }
  } catch (taskErr) {
    console.error("[GPS Task] Unhandled error:", taskErr);
  }
});

export default function MainScreen() {
  const router = useRouter();
  const {
    profile,
    setProfile,
    isOnline,
    setOnline,
    orderAlert,
    setOrderAlert,
    enqueueOrderAlert,
    dequeueOrderAlert,
    removeOrderFromQueue,
    activeOrder,
    setActiveOrder,
    tripDistance,
    tripPrice,
    tripStartTime,
    setTripMeter,
    resetTrip,
    startTrip,
    isOutOfCity,
    outOfCityStartTime,
  } = useDriverStore();

  const [loading, setLoading] = useState(false);
  const [alertTimer, setAlertTimer] = useState(30);
  const [activeTab, setActiveTab] = useState<DriverTab>("home");
  const [currentCoords, setCurrentCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [refreshingGPS, setRefreshingGPS] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripDistanceRef = useRef(0);
  const insets = useSafeAreaInsets();
  const loadingDashboardRef = useRef(false);
  const soundRef = useRef<any>(null);
  const mapRef = useRef<YandexMapViewHandle>(null);
  // Prevents loadDashboard from overriding status while toggle is in flight
  const togglingOnlineRef = useRef(false);
  // Prevents race: 30s interval's loadDashboard re-activating a just-completed order
  const completedOrderIdRef = useRef<number | null>(null);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Throttle route rebuilds during in_progress trips (max 1 per 30s)
  const routeThrottleRef = useRef<number>(0);
  const completionRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pointsRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Android hardware back button → go to home tab, not exit ───────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) { setMenuOpen(false); return true; }
      if (activeTab !== 'home') { setActiveTab('home'); return true; }
      return false; // let the OS handle it (minimise / exit)
    });
    return () => sub.remove();
  }, [activeTab, menuOpen]);

  // Dispatcher-assigned order modal
  const [dispatcherAssignedOrder, setDispatcherAssignedOrder] = useState<any>(null);

  type TripSummary = {
    distanceKm: number | null;
    finalPrice: number;
    waitingFee: number;
    waitingAccumulatedSeconds: number;
    breakdown: {
      baseFare: number;
      cityKm: number;
      cityRatePerKm: number;
      outOfCityKm: number;
      outOfCityKmRate: number;
      outOfCitySeconds: number;
    } | null;
  };
  const [tripSummary, setTripSummary] = useState<TripSummary | null>(null);
  const [forceUpdateModal, setForceUpdateModal] = useState<{ message: string; downloadUrl: string | null } | null>(null);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch(console.warn);

    return () => {
      soundRef.current?.unloadAsync().catch(() => { });
    };
  }, []);

  // Pre-fetch city boundary at app startup so zone detection works even if
  // network drops later during an active trip.
  useEffect(() => {
    void (async () => {
      if (useDriverStore.getState().cityBoundary) return; // already cached
      try {
        const resp = await fetch(`${API_BASE}/api/geozones`);
        const geoData: any[] = await resp.json();
        const zone = geoData.find((z: any) => z.type === "city_boundary" && z.isActive && z.geojson);
        if (zone?.geojson?.coordinates?.[0]) {
          useDriverStore.getState().setCityBoundary(zone.geojson.coordinates[0]);
        }
      } catch { /* Non-critical — will retry at trip start */ }
    })();
  }, []);

  // Держим экран включённым пока водитель на линии или везёт клиента
  useEffect(() => {
    const shouldStayOn = isOnline || !!activeOrder;
    if (shouldStayOn) {
      activateKeepAwakeAsync().catch(() => { });
    } else {
      deactivateKeepAwake();
    }
  }, [isOnline, activeOrder]);

  const playAppSound = async (type: 'new_order' | 'welcome' | 'trip_completed') => {
    try {
      // Unload previous sound before creating a new one to prevent leaks
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => { });
        soundRef.current = null;
      }

      const sources = {
        new_order: require('../assets/sounds/new_order.mp3'),
        welcome: require('../assets/sounds/welcome.mp4'),
        trip_completed: require('../assets/sounds/trip_completed.mp4'),
      };

      const { sound } = await Audio.Sound.createAsync(sources[type]);
      soundRef.current = sound;
      await sound.playAsync();

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => { });
          soundRef.current = null;
        }
      });
    } catch (err) {
      console.warn("Failed to play sound", err);
    }
  };

  const lastLocationState = useDriverStore((s) => s.lastLocation);
  useEffect(() => {
    if (lastLocationState) {
      setCurrentCoords({ latitude: lastLocationState.lat, longitude: lastLocationState.lng });
    }
  }, [lastLocationState]);

  // Sync heading from store → local state for map icon rotation
  const [currentHeading, setCurrentHeading] = useState<number | null>(null);
  const lastHeadingState = useDriverStore((s) => s.lastHeading);
  useEffect(() => {
    if (lastHeadingState !== null) {
      setCurrentHeading(lastHeadingState);
    }
  }, [lastHeadingState]);

  const realtimeDriverRef = useRef<number | null>(null);

  const refreshCurrentPosition = useCallback(async () => {
    setRefreshingGPS(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Геолокация", "Предоставьте доступ к GPS в настройках");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      useDriverStore.getState().setLastLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      const nextCoords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setCurrentCoords(nextCoords);
      useDriverStore.getState().setLastLocation({ lat: nextCoords.latitude, lng: nextCoords.longitude });

      // Update server immediately
      api("/api/driver/location", {
        method: "POST",
        body: JSON.stringify({ lat: nextCoords.latitude, lng: nextCoords.longitude }),
      });
    } catch (e) {
      console.error("GPS Refresh Error:", e);
    } finally {
      setRefreshingGPS(false);
    }
  }, []);

  const startLocationTracking = useCallback(async () => {
    // Always grab a fresh GPS fix when going online so currentCoords is
    // never null — even if the background task is already running from a
    // previous session. This is the key fix for the "map crosshair +
    // GPS button required before calculation" problem.
    await refreshCurrentPosition();

    // If the background task is already registered we only needed the
    // one-shot position above — don't double-start the task.
    const alreadyRunning = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
    if (alreadyRunning) return;

    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== "granted") {
      Alert.alert("GPS", "Нужен доступ к GPS для работы на линии");
      return;
    }

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();

    if (bgStatus !== "granted") {
      Alert.alert("Фоновый GPS", "Разрешите доступ 'Всегда' в настройках для точного подсчёта пути.");
    }

    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 3,   // 3m — точнее на поворотах
      timeInterval: 1000,    // каждую секунду даже стоя — минимальный drift
      foregroundService: {
        notificationTitle: "Карамурт — вы на линии",
        notificationBody: "Приложение отслеживает ваше местоположение.",
        notificationColor: "#FFD000",
      },
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
    });
  }, [refreshCurrentPosition]);

  const stopLocationTracking = useCallback(async () => {
    try {
      const hasTask = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      if (hasTask) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
    } catch { }
  }, []);

  const logout = useCallback(async () => {
    stopLocationTracking();
    disconnectSocket();
    realtimeDriverRef.current = null;
    await clearToken();
    setProfile(null);
    setOnline(false);
    router.replace("/login");
  }, [router, setOnline, setProfile, stopLocationTracking]);

  const mapOrderToState = useCallback((order: any) => {
    if (!order) return null;
    // Read vehicle classes at call time to avoid stale-closure issues
    const vehicleClasses = useDriverStore.getState().profile?.vehicle?.classes;
    const currentBaseFare = resolveBaseFare(order.class, vehicleClasses);
    return mapOrderToActiveOrder(order, currentBaseFare);
  }, []);

  const refreshProfileRank = useCallback(async () => {
    const profileRes = await api("/api/driver/profile");
    if (profileRes.data) {
      setProfile(profileRes.data);
    }
  }, [setProfile]);

  const startSocketAndGPS = useCallback((driverId: number) => {
    const sock = connectSocket(driverId);

    sock.off("new_order_alert");
    sock.off("order_taken");
    sock.off("driver_ratings_updated");
    sock.off("connect");

    // Auto-reconnect: re-register driver room after reconnect (e.g. after bg kill)
    // Also flush any pending offline ops — network is back.
    sock.on("connect", () => {
      sock.emit("driver_connect", driverId);
      void syncPendingCompletion();
      void syncPendingStatus();
    });

    sock.on("new_order_alert", (data: any) => {
      if (data.classId) {
        const p = useDriverStore.getState().profile;
        const hasClass = p?.vehicle?.classes?.some((c: any) => c.classId === data.classId);
        if (!hasClass) return;
      }

      const state = useDriverStore.getState();

      // Ignore if driver already has an active order
      if (state.activeOrder) return;

      // Drop duplicate alerts
      if (
        state.orderAlert?.orderId === data.orderId ||
        state.orderQueue.some((o) => o.orderId === data.orderId)
      ) return;

      // Cap queue at 5 to prevent flooding the driver with stale orders
      const QUEUE_LIMIT = 5;
      const totalQueued = (state.orderAlert ? 1 : 0) + state.orderQueue.length;
      if (totalQueued >= QUEUE_LIMIT) return;

      Vibration.vibrate([0, 500, 200, 500]);
      playAppSound('new_order');
      showOrderNotification(data.pickupAddress, data.pricePerKm || 80);

      if (!state.orderAlert) {
        // No active alert — show immediately
        setOrderAlert(data);
        setAlertTimer(30);
      } else {
        // Alert already showing — enqueue
        enqueueOrderAlert(data);
      }
    });

    sock.on("order_taken", (data: any) => {
      // Instantly dismiss order modal if taken by another driver
      const currentAlert = useDriverStore.getState().orderAlert;
      if (currentAlert && currentAlert.orderId === data.orderId) {
        setOrderAlert(null);
      }
      removeOrderFromQueue(data.orderId);
    });

    // Dispatcher removed this order from us
    sock.on("order_reassigned", (data: any) => {
      const state = useDriverStore.getState();
      if (state.activeOrder?.id === data.orderId) {
        setActiveOrder(null);
        resetTrip();
        Alert.alert("Диспетчер", data.message || "Заказ был снят с вас");
      }
    });

    // Dispatcher assigned an order directly to us
    sock.on("order_assigned_by_dispatcher", (data: any) => {
      Vibration.vibrate([0, 400, 150, 400, 150, 400]);
      playAppSound('new_order');
      const mapped = mapOrderToState(data.order);
      setActiveOrder(mapped);
      setActiveTab("home");
      setDispatcherAssignedOrder(data.order); // Show dedicated modal
    });

    sock.on("order_updated", (data: any) => {
      const state = useDriverStore.getState();
      const currentOrder = state.activeOrder;
      if (currentOrder && currentOrder.id === data.orderId) {
        setActiveOrder({
          ...currentOrder,
          estimatedPrice: data.estimatedPrice,
          options: data.options,
        });

        // For in_progress metered trips: re-sync tripBaseFare to include new options
        // so the running price counter reflects the dispatcher's change immediately.
        if (currentOrder.status === "in_progress" && !currentOrder.isFixedPrice) {
          const newOptions: any[] = Array.isArray(data.options) ? data.options : [];
          const extrasTotal = newOptions.reduce(
            (sum: number, o: any) => sum + (Number(o.price) || 0), 0
          );
          const classBaseFare = resolveBaseFare(
            currentOrder.class,
            state.profile?.vehicle?.classes
          );
          const newBaseFare = classBaseFare + extrasTotal;
          state.setTripBaseFare(newBaseFare);
          // Immediately update the displayed price
          const cityRate = state.tripCityRatePerKm || Number(currentOrder.pricePerKm) || 80;
          state.setTripMeter(
            state.tripDistance,
            roundTo5(newBaseFare + state.tripDistance * cityRate)
          );
        }
      }
    });

    sock.on("zone_change", (data: { isOutOfCity: boolean; outOfCityRatePerKm: number; message: string }) => {
      const s = useDriverStore.getState();
      // Only react during active trip
      if (s.activeOrder?.status !== "in_progress") return;

      s.setZoneChange({
        isOutOfCity: data.isOutOfCity,
        outOfCityRatePerKm: data.outOfCityRatePerKm,
        currentPrice: s.tripPrice,
        currentDistance: s.tripDistance,
      });

      Vibration.vibrate([0, 200, 100, 200]);
      Alert.alert(
        data.isOutOfCity ? "Выезд за город" : "Возврат в город",
        data.message,
        [{ text: "OK" }],
        { cancelable: true }
      );
    });

    sock.on("driver_ratings_updated", () => {
      refreshProfileRank();
    });

    sock.on("force_update", (data: { message: string; downloadUrl: string | null }) => {
      setForceUpdateModal({ message: data.message, downloadUrl: data.downloadUrl });
    });

    startLocationTracking();

    if (realtimeDriverRef.current !== driverId) {
      registerForPushNotifications();
    }
    realtimeDriverRef.current = driverId;
  }, [refreshProfileRank, setOrderAlert, startLocationTracking]);

  const loadDashboard = useCallback(async () => {
    // Prevent concurrent calls from interval + AppState firing simultaneously
    if (loadingDashboardRef.current) return;
    loadingDashboardRef.current = true;

    const [profileRes, orderRes] = await Promise.all([
      api("/api/driver/profile"),
      api("/api/driver/orders/current"),
    ]);

    try {
      if (!profileRes.data) {
        if (!useDriverStore.getState().profile) {
          await logout();
        }
        return;
      }

      const nextProfile = profileRes.data;

      // Игнорируем ошибки сети при получении заказа, чтобы не сбрасывать стейт
      let nextOrder = useDriverStore.getState().activeOrder;
      if (!orderRes.error) {
        let nextOrder = mapOrderToState(orderRes.data);
        // Race guard: if this loadDashboard() was in-flight BEFORE we completed the
        // order (30s interval timing), the server may still return the old in_progress
        // order. Don't re-activate it — force null instead.
        if (completedOrderIdRef.current !== null && nextOrder?.id === completedOrderIdRef.current) {
          nextOrder = null;
        }
        setActiveOrder(nextOrder);

        // Restore counter after app kill (e.g. driver opened Yandex Navigator)
        if (nextOrder?.status === "in_progress" && !nextOrder.isFixedPrice) {
          const currentStore = useDriverStore.getState();
          if (currentStore.tripDistance === 0 && currentStore.tripStartTime) {
            const saved = await loadTripMetrics(nextOrder.id);
            if (saved && saved.tripDistance > 0) {
              currentStore.setTripMeter(saved.tripDistance, saved.tripPrice);
              useDriverStore.setState({
                outOfCityAccumulatedKm: saved.outOfCityKm,
                outOfCityAccumulatedSeconds: saved.outOfCitySeconds,
              });
            }
          }
        }
      }

      // Не перезаписываем online-статус пока водитель активно переключает линию
      // (toggleOnline ждёт API, loadDashboard не должен конкурировать)
      if (togglingOnlineRef.current) return;

      const shouldStayConnected = nextProfile.status !== "offline" || !!nextOrder;

      setProfile(nextProfile);
      setOnline(shouldStayConnected);

      if (shouldStayConnected) {
        const sock = getSocket();
        const socketNeedsInit = !sock || !sock.connected || realtimeDriverRef.current !== nextProfile.id;
        const isInTrip = useDriverStore.getState().activeOrder?.status === "in_progress";
        if (socketNeedsInit && !isInTrip) {
          startSocketAndGPS(nextProfile.id);
        }
      } else {
        stopLocationTracking();
        disconnectSocket();
        realtimeDriverRef.current = null;
      }
    } finally {
      loadingDashboardRef.current = false;
    }
  }, [logout, mapOrderToState, setActiveOrder, setOnline, setProfile, startSocketAndGPS, stopLocationTracking]);

  useEffect(() => {
    loadDashboard();
    // Init GraphHopper in background — doesn't block UI
    void initGraphHopper();
  }, [loadDashboard]);

  useEffect(() => {
    if (!activeOrder || activeOrder.status !== "in_progress" || activeOrder.isFixedPrice) {
      return;
    }

    // Reset only when a NEW trip starts (order ID changes) — NOT on every
    // loadDashboard that refreshes the activeOrder object reference.
    // Previously [activeOrder] caused resetOdometer() every 30s → 0 km bug.
    resetOdometer();

    void startTripSync(activeOrder.id).then(() => flushTripPoints(activeOrder.id));

    // Independent GPS flush retry — fires every 30s even when GPS accuracy is
    // poor (accuracy > 40m) and no new points are being queued. Without this,
    // already-queued points can get stuck when GPS quality degrades mid-trip.
    if (pointsRetryRef.current) clearInterval(pointsRetryRef.current);
    pointsRetryRef.current = setInterval(() => {
      void flushTripPoints(activeOrder.id);
    }, 30_000);

    return () => {
      if (pointsRetryRef.current) {
        clearInterval(pointsRetryRef.current);
        pointsRetryRef.current = null;
      }
    };
  }, [activeOrder?.id, activeOrder?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Map route: build or clear depending on order status ──────────────────
  useEffect(() => {
    if (!mapRef.current) return;

    if (!activeOrder) {
      // No active order — wipe any leftover route
      mapRef.current.clearRoute();
      return;
    }

    const pickup = parseWktPoint(activeOrder.pickupPoint);
    const dropoff = parseWktPoint(activeOrder.dropoffPoint);

    if (activeOrder.status === "assigned" && pickup) {
      if (currentCoords) {
        // Driver heading to client → route: my position → pickup
        mapRef.current.buildRoute(currentCoords, pickup, true);
      } else {
        // GPS not ready yet — refresh and the next coords update
        // will re-trigger this effect via the periodic rebuild effect
        refreshCurrentPosition();
      }
    } else if (activeOrder.status === "arrived") {
      // Driver is on-site — no route needed
      mapRef.current.clearRoute();
    } else if (activeOrder.status === "in_progress" && dropoff) {
      if (currentCoords) {
        // Trip started → route: my position → dropoff
        routeThrottleRef.current = Date.now();
        mapRef.current.buildRoute(currentCoords, dropoff, true);
      } else {
        refreshCurrentPosition();
      }
    } else {
      mapRef.current.clearRoute();
    }
    // Only re-run when the order status changes, not on every coords update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.status, activeOrder?.id]);

  // ── Map route: periodic rebuild during trip (max 1 per 30 s) ─────────────
  useEffect(() => {
    if (!activeOrder || activeOrder.status !== "in_progress") return;
    if (!currentCoords || !mapRef.current) return;

    const dropoff = parseWktPoint(activeOrder.dropoffPoint);
    if (!dropoff) return;

    const THROTTLE_MS = 30_000;
    const elapsed = Date.now() - routeThrottleRef.current;
    if (elapsed < THROTTLE_MS) return;

    routeThrottleRef.current = Date.now();
    // fitBounds=false to keep the viewport where the driver is
    mapRef.current.buildRoute(currentCoords, dropoff, false);
    // Runs whenever currentCoords changes, but the throttle gate limits actual rebuilds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCoords]);

  // Ref to track the offline-on-background timeout
  const bgOfflineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") {
        // Cancel any pending offline transition
        if (bgOfflineTimerRef.current) {
          clearTimeout(bgOfflineTimerRef.current);
          bgOfflineTimerRef.current = null;
        }

        // Reconnect socket + restart GPS task if dropped while in background
        const storeState = useDriverStore.getState();
        if (storeState.isOnline && storeState.profile) {
          const sock = getSocket();
          if (!sock || !sock.connected) {
            startSocketAndGPS(storeState.profile.id);
          } else {
            // Socket is fine — but GPS task may have been killed by Android.
            // Restart it silently if not running.
            Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
              .then((running) => { if (!running) startLocationTracking(); })
              .catch(() => {});
          }
        }

        // Sync any pending completion FIRST, so loadDashboard sees the correct
        // order state (completed) rather than stale in_progress from server.
        void (async () => {
          const ok = await syncPendingCompletion();
          // If sync succeeded, server now shows completed — clear the race guard
          if (ok) completedOrderIdRef.current = null;
          loadDashboard();
        })();
      }
      // ✅ FIX 2: NEVER auto-go-offline. Driver works full day, app can be in background.
      // The driver manually controls their online/offline status.
    });

    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        loadDashboard();
      } else {
        // Background: only reconnect socket if dropped, no API polling
        const sock = getSocket();
        const storeState = useDriverStore.getState();
        if (storeState.isOnline && (!sock || !sock.connected) && storeState.profile) {
          connectSocket(storeState.profile.id);
        }
      }
    }, 30000);

    return () => {
      subscription.remove();
      clearInterval(interval);
      if (bgOfflineTimerRef.current) clearTimeout(bgOfflineTimerRef.current);
      if (completionRetryRef.current) clearInterval(completionRetryRef.current);
      if (statusRetryRef.current) clearInterval(statusRetryRef.current);
      if (pointsRetryRef.current) clearInterval(pointsRetryRef.current);
    };
  }, [loadDashboard, startSocketAndGPS]);

  useEffect(() => {
    if (orderAlert) {
      setAlertTimer(30);
      timerRef.current = setInterval(() => {
        setAlertTimer((prev) => {
          if (prev <= 1) {
            // Timer expired — show next queued alert (or null if queue empty)
            dequeueOrderAlert();
            return 30;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [orderAlert, dequeueOrderAlert]);

  const toggleOnline = async () => {
    // Prevent double-tap and race with loadDashboard
    if (togglingOnlineRef.current) return;

    const newStatus = isOnline ? "offline" : "free";
    const newIsOnline = !isOnline;

    togglingOnlineRef.current = true;
    setTogglingOnline(true);

    // Optimistic UI update
    setOnline(newIsOnline);
    setProfile(profile ? { ...profile, status: newStatus as any } : null);

    if (newIsOnline && profile) {
      startSocketAndGPS(profile.id);
      // Phase 4: Pre-cache OSM tiles for the driver's area silently in background
      if (currentCoords) {
        // Small delay so map WebView is ready
        setTimeout(() => {
          mapRef.current?.preloadArea(currentCoords.latitude, currentCoords.longitude, 20);
        }, 3000);
      }
    } else {
      stopLocationTracking();
      disconnectSocket();
      realtimeDriverRef.current = null;
    }

    // Await — not fire-and-forget, so loadDashboard can't race
    const res = await api("/api/driver/status", {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus }),
    });

    togglingOnlineRef.current = false;
    setTogglingOnline(false);

    if (res.error) {
      // Rollback optimistic update on network error
      setOnline(!newIsOnline);
      setProfile(profile ? { ...profile, status: isOnline ? "free" : "offline" } : null);
      if (!newIsOnline && profile) {
        startSocketAndGPS(profile.id);
      } else {
        stopLocationTracking();
        disconnectSocket();
        realtimeDriverRef.current = null;
      }

      // 426 = version too old → show force update modal instead of generic error
      if ((res as any).forceUpdate) {
        setForceUpdateModal({
          message: res.error,
          downloadUrl: (res as any).downloadUrl ?? null,
        });
      } else {
        Alert.alert("Ошибка", "Не удалось изменить статус. Проверьте соединение.");
      }
    }
  };

  const acceptOrder = async () => {
    if (!orderAlert) return;
    // Stop the alert sound immediately on accept
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); } catch {}
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }

    // ✅ FIX 3: Optimistic dismiss — close modal instantly, don't freeze UI
    const alertSnapshot = orderAlert;
    setOrderAlert(null);
    setLoading(true);

    const res = await api(`/api/driver/orders/${alertSnapshot.orderId}/accept`, {
      method: "POST",
    });
    setLoading(false);

    if (res.error) {
      // Order was already taken — just silently ignore (modal already closed)
      // If it's a real error, show it but don't reopen modal
      if (!res.error.includes("уже назначен") && !res.error.includes("taken")) {
        Alert.alert("Ошибка", res.error);
      }
      return;
    }

    setActiveOrder(mapOrderToState(res.data));
    resetTrip();
    setActiveTab("home");
    loadDashboard();
  };

  const rejectOrder = async () => {
    // Stop the alert sound immediately on reject
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); } catch {}
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
    // Show next queued alert instead of just clearing
    dequeueOrderAlert();
  };

  const handleCurbsideOrder = async () => {
    setLoading(true);
    const res = await api(`/api/driver/orders/curbside`, {
      method: "POST",
    });
    setLoading(false);

    if (res.error) {
      Alert.alert("Ошибка", res.error);
      return;
    }

    const order = res.data;
    const serverSessionId: number | null = order._sessionId ?? null;

    // Use server-resolved base fare and city rate (class-aware, already computed)
    const vehicleClasses = useDriverStore.getState().profile?.vehicle?.classes;
    const serverBaseFare = Number(order._baseFare) || resolveBaseFare(order.class, vehicleClasses);
    const serverCityRate = Number(order._cityRate) || Number(order.pricePerKm) || 80;

    setActiveOrder(mapOrderToState(order));
    resetTrip();
    useDriverStore.getState().setTripBaseFare(serverBaseFare);
    useDriverStore.getState().setTripCityRate(serverCityRate);
    startTrip();
    tripDistanceRef.current = 0;
    useDriverStore.getState().setTripMeter(0, serverBaseFare);
    setTripMeter(0, serverBaseFare);

    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }).then((loc) => {
      useDriverStore.getState().setLastLocation({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
    });

    void (async () => {
      // Inject session + server-resolved rates so getTripRates() works without extra /trip/start call
      const serverOutOfCityRate = Number(order._outOfCityRate ?? 0);
      if (serverSessionId) {
        await injectSessionId(order.id, serverSessionId, serverBaseFare, serverCityRate, serverOutOfCityRate);
      }
      // Store configured rate + fetch city boundary for client-side zone detection
      if (serverOutOfCityRate > 0) {
        useDriverStore.getState().setConfiguredOutOfCityRate(serverOutOfCityRate);
      }
      if (!useDriverStore.getState().cityBoundary) {
        try {
          const resp = await fetch(`${API_BASE}/api/geozones`);
          const geoData: any[] = await resp.json();
          const bd = geoData.find((z: any) => z.type === "city_boundary" && z.isActive && z.geojson);
          if (bd?.geojson?.coordinates?.[0]) {
            useDriverStore.getState().setCityBoundary(bd.geojson.coordinates[0]);
          }
        } catch { }
      }
      await startTripSync(order.id);
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
        const seedPoint = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          capturedAt: new Date(loc.timestamp).toISOString(),
          accuracyM: typeof loc.coords.accuracy === "number" ? loc.coords.accuracy : null,
          speedKmh: typeof loc.coords.speed === "number" && Number.isFinite(loc.coords.speed) ? loc.coords.speed * 3.6 : null,
          headingDeg: typeof loc.coords.heading === "number" && Number.isFinite(loc.coords.heading) ? loc.coords.heading : null,
        };
        useDriverStore.getState().setLastLocation({ lat: seedPoint.lat, lng: seedPoint.lng });
        // ── Immediate zone check at trip start ─────────────────────────────────
        // Detects out-of-city from the very first second (no border crossing needed).
        // The background GPS loop only checks zone on subsequent points; this covers
        // the case where the driver starts the trip already outside the city.
        const storeNow = useDriverStore.getState();
        const boundary = storeNow.cityBoundary;
        if (boundary && boundary.length > 2) {
          const insideCity = pointInPolygon(seedPoint.lat, seedPoint.lng, boundary);
          if (!insideCity && !storeNow.isOutOfCity) {
            const outRate = storeNow.configuredOutOfCityRate > 0
              ? storeNow.configuredOutOfCityRate
              : (storeNow.profile?.vehicle?.classes?.some((c: any) => c.class?.name === "Комфорт") ? 140 : 120);
            storeNow.setZoneChange({
              isOutOfCity: true,
              outOfCityRatePerKm: outRate,
              currentPrice: storeNow.tripPrice,
              currentDistance: storeNow.tripDistance,
            });
          }
        }
        // ───────────────────────────────────────────────────────────────────────
        await queueTripPoint(order.id, seedPoint);

      } catch { }
    })();
  };

  const toggleTripWaiting = async (action: "start" | "stop") => {
    if (!activeOrder || activeOrder.status !== "in_progress") return;

    setLoading(true);
    const res = await api(`/api/driver/orders/${activeOrder.id}/waiting`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    setLoading(true); // Keep loading until state is updated to prevent double-clicks

    if (res.error) {
      setLoading(false);
      Alert.alert("Ошибка", res.error);
      return;
    }

    if (res.data) {
      setActiveOrder(mapOrderToState(res.data));
    }
    setLoading(false);
  };

  const updateOrderStatus = async (status: string) => {
    if (!activeOrder) return;

    const body: any = { status };

    if (status === "in_progress") {
      // Server confirmed in_progress — clear any pending status saved during offline start
      void clearPendingStatus();

      playAppSound('welcome');
      startTrip();

      const currentBaseFare = resolveBaseFare(activeOrder.class, profile?.vehicle?.classes);
      const options: any[] = Array.isArray(activeOrder.options) ? activeOrder.options : [];
      const extrasTotal = options.reduce((sum, opt) => sum + (Number(opt.price) || 0), 0);
      let baseTripFare = activeOrder.isFixedPrice ? activeOrder.estimatedPrice! : (currentBaseFare + extrasTotal);
      if (activeOrder.arrivedAt) {
        // Calculate waiting fee locally for the UI (server matches this logic)
        const waitMs = Date.now() - new Date(activeOrder.arrivedAt).getTime();
        const waitMins = Math.floor(waitMs / 60000);
        if (waitMins > 3) {
          baseTripFare += (waitMins - 3) * 20;
        }
      }

      // Сохраняем реальную базовую ставку (с учётом ожидания у клиента)
      // чтобы фоновый таск и fallback при завершении использовали правильное значение
      useDriverStore.getState().setTripBaseFare(baseTripFare);

      tripDistanceRef.current = 0;
      useDriverStore.getState().setTripMeter(0, baseTripFare);
      setTripMeter(0, baseTripFare);

      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }).then((loc) => {
        useDriverStore.getState().setLastLocation({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        });
      });
    }

    if (status === "completed") {
      playAppSound('trip_completed');
      if (!activeOrder.isFixedPrice) {
        // Flush remaining GPS points to server (for audit logs)
        void flushTripPoints(activeOrder.id);

        const storeState = useDriverStore.getState();
        const kalmanDist = Math.round(Math.max(storeState.tripDistance, tripDistanceRef.current) * 10) / 10;
        const baseFare = storeState.tripBaseFare || resolveBaseFare(
          activeOrder.class,
          storeState.profile?.vehicle?.classes
        );
        const cityRate = storeState.tripCityRatePerKm || Number(activeOrder.pricePerKm) || 80;
        const accSec = storeState.outOfCityAccumulatedSeconds;
        const currentOutSec = storeState.isOutOfCity && storeState.outOfCityStartTime
          ? Math.floor((Date.now() - storeState.outOfCityStartTime) / 1000)
          : 0;
        const outTimeFeeAtCompletion = Math.floor((accSec + currentOutSec) / 60) * 25;
        const clientOutOfCityKm = storeState.outOfCityAccumulatedKm;

        // ── GraphHopper map matching ─────────────────────────────────────────
        // Try to improve distance accuracy using offline road-network matching.
        // Falls back to Kalman odometer if GraphHopper is unavailable.
        let finalDistKm = kalmanDist;
        try {
          const allPoints = getTripPointsForMatching(activeOrder.id);
          if (allPoints.length >= 10) {
            const matchedKm = await matchTripPoints(allPoints);
            if (matchedKm !== null && matchedKm > 0) {
              // Sanity check: matched distance must be within 20% of Kalman
              // (protects against bad map matching on unmapped rural roads)
              const ratio = matchedKm / kalmanDist;
              if (ratio >= 0.8 && ratio <= 1.3) {
                finalDistKm = Math.round(matchedKm * 10) / 10;
                console.log(`[MapMatch] Kalman=${kalmanDist} → Matched=${finalDistKm} km`);
              } else {
                console.log(`[MapMatch] Ratio ${ratio.toFixed(2)} out of range, using Kalman`);
              }
            }
          }
        } catch (e) {
          console.warn("[MapMatch] Failed, using Kalman:", e);
        }
        // ────────────────────────────────────────────────────────────────────

        const outRate = storeState.outOfCityRatePerKm || cityRate;
        const cityKm = Math.max(0, finalDistKm - clientOutOfCityKm);
        const matchedPrice = Math.round(
          (baseFare + cityKm * cityRate + clientOutOfCityKm * outRate + outTimeFeeAtCompletion) / 5
        ) * 5;

        body.clientDistanceKm = finalDistKm;
        body.clientOutOfCityKm = Math.round(clientOutOfCityKm * 10) / 10;
        body.clientOutOfCitySeconds = accSec + currentOutSec;
        body.clientFinalPrice = matchedPrice + tripWaitingFee;

      } else {
        // Fixed-price: явно передаём цену
        if (activeOrder.distanceKm > 0) {
          body.distanceKm = activeOrder.distanceKm;
        }
        body.finalPrice = (activeOrder.estimatedPrice ?? activeOrder.currentPrice) + tripWaitingFee;
      }
      // Передаём текущие координаты для обратного геокодирования точки выгрузки
      if (lastLocationState) {
        body.lat = lastLocationState.lat;
        body.lng = lastLocationState.lng;
      }
    }

    setLoading(true);
    const res = await api(`/api/driver/orders/${activeOrder.id}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setLoading(false);

    if (res.error) {
      if (status === "completed") {
        // ── Offline completion: network failed but driver must NOT be stuck ──
        // Save the full request body locally — will retry when network returns.
        // Show the summary modal from store data immediately so driver sees the price.
        await savePendingCompletion({ orderId: activeOrder.id, body, savedAt: Date.now() });

        const ss = useDriverStore.getState();
        const offlineDist = body.clientDistanceKm as number ?? ss.tripDistance;
        const offlinePrice = body.clientFinalPrice as number ?? ss.tripPrice;
        const offlineBaseFare = ss.tripBaseFare || resolveBaseFare(activeOrder.class, ss.profile?.vehicle?.classes);
        const offlineCityRate = ss.tripCityRatePerKm || Number(activeOrder.pricePerKm) || 80;
        const offlineOutKm = (body.clientOutOfCityKm as number) ?? ss.outOfCityAccumulatedKm;
        const offlineCityKm = Math.max(0, offlineDist - offlineOutKm);

        setTripSummary({
          distanceKm: offlineDist,
          finalPrice: offlinePrice,
          waitingFee: tripWaitingFee,
          waitingAccumulatedSeconds: 0,
          breakdown: {
            baseFare: offlineBaseFare,
            cityKm: offlineCityKm,
            cityRatePerKm: offlineCityRate,
            outOfCityKm: offlineOutKm,
            outOfCityKmRate: ss.configuredOutOfCityRate || 120,
            outOfCitySeconds: ss.outOfCityAccumulatedSeconds,
          },
        });

        // Race guard: prevent 30s interval from re-activating this order
        // while the server still shows it as in_progress (pending sync).
        completedOrderIdRef.current = activeOrder.id;

        // Free the driver locally — server will be updated when network returns.
        // NOTE: do NOT call clearTripSync here — pending GPS points must survive so
        // syncPendingCompletion can flush them to the server before the PATCH.
        setActiveOrder(null);
        resetTrip();
        setProfile(profile ? { ...profile, status: "free" } : null);
        // NOTE: do NOT call loadDashboard() here!
        // The server still shows the order as in_progress (we failed to PATCH it),
        // so loadDashboard() would immediately re-set activeOrder and undo our null.

        // Retry sync in background every 30s; refresh UI only after server confirms.
        if (completionRetryRef.current) clearInterval(completionRetryRef.current);
        completionRetryRef.current = setInterval(async () => {
          const ok = await syncPendingCompletion();
          if (ok) {
            if (completionRetryRef.current) clearInterval(completionRetryRef.current);
            completionRetryRef.current = null;
            completedOrderIdRef.current = null;
            loadDashboard();
          }
        }, 30000);
      } else if (status === "arrived" || status === "in_progress") {
        // ── Offline status update ───────────────────────────────────────────────
        // Network failed but driver must NOT be stuck.
        // 1. Optimistic local update — UI advances to correct screen.
        // 2. For in_progress: GPS task checks status === "in_progress"; without
        //    this update the task would NOT accumulate distance (290₸ bug).
        // 3. Retry in background every 15s until server confirms.
        // 4. Server now accepts arrived→completed so even if in_progress never
        //    syncs, the completion PATCH will succeed.
        setActiveOrder({ ...activeOrder, status });
        await savePendingStatus({ orderId: activeOrder.id, status: status as "arrived" | "in_progress", savedAt: Date.now() });
        if (statusRetryRef.current) clearInterval(statusRetryRef.current);
        statusRetryRef.current = setInterval(async () => {
          const ok = await syncPendingStatus();
          if (ok) {
            if (statusRetryRef.current) clearInterval(statusRetryRef.current);
            statusRetryRef.current = null;
          }
        }, 15000);
        // Don't show an error — driver continues the trip normally
      } else {
        Alert.alert("Ошибка", res.error);
      }
      return;
    }

    if (status === "completed" || status === "canceled") {
      // Используем данные, рассчитанные сервером и возвращённые в ответе
      const serverDist = res.data?.distanceKm != null ? Number(res.data.distanceKm) : null;
      const serverPrice = res.data?.finalPrice != null ? Number(res.data.finalPrice) : null;

      if (activeOrder.isFixedPrice) {
        Alert.alert(
          status === "completed" ? "Поездка завершена" : "Заказ отменен",
          `Итого: ${serverPrice ?? activeOrder.estimatedPrice} ₸`,
        );
      } else if (status === "completed") {
        if (serverDist !== null && serverPrice !== null) {
          setTripSummary({
            distanceKm: serverDist,
            finalPrice: serverPrice,
            waitingFee: res.data?.waitingFee ?? 0,
            waitingAccumulatedSeconds: res.data?.waitingAccumulatedSeconds ?? 0,
            breakdown: res.data?.breakdown ?? null,
          });
        } else {
          // Fallback: no GPS data — build from store snapshot
          const storeState = useDriverStore.getState();
          const fallbackDist = Math.round(Math.max(storeState.tripDistance, tripDistanceRef.current) * 10) / 10;
          const fallbackBaseFare = storeState.tripBaseFare || resolveBaseFare(
            activeOrder.class,
            storeState.profile?.vehicle?.classes
          );
          const fallbackCityRate = storeState.tripCityRatePerKm || Number(activeOrder.pricePerKm) || 80;
          const fallbackOutKm = storeState.outOfCityAccumulatedKm ?? 0;
          const fallbackOutSec = storeState.outOfCityAccumulatedSeconds ?? 0;
          const fallbackCityKm = Math.max(0, fallbackDist - fallbackOutKm);
          const fallbackOutRate = storeState.configuredOutOfCityRate || 120;
          const fallbackOutTimeFee = Math.floor(fallbackOutSec / 60) * 25;
          const fallbackPrice = roundTo5(
            fallbackBaseFare
            + fallbackCityKm * fallbackCityRate
            + fallbackOutKm * fallbackOutRate
            + fallbackOutTimeFee
          );
          setTripSummary({
            distanceKm: fallbackDist,
            finalPrice: fallbackPrice,
            waitingFee: res.data?.waitingFee ?? 0,
            waitingAccumulatedSeconds: res.data?.waitingAccumulatedSeconds ?? 0,
            breakdown: {
              baseFare: fallbackBaseFare,
              cityKm: fallbackCityKm,
              cityRatePerKm: fallbackCityRate,
              outOfCityKm: fallbackOutKm,
              outOfCityKmRate: fallbackOutRate,
              outOfCitySeconds: fallbackOutSec,
            },
          });
        }
      } else {
        Alert.alert("Заказ отменен", "");
      }

      // Mark this order as just-completed so any in-flight loadDashboard() from the
      // 30s interval cannot re-activate it with a stale in_progress response.
      completedOrderIdRef.current = activeOrder.id;
      setActiveOrder(null);
      resetTrip();
      await clearTripSync(activeOrder.id);
      void clearTripMetrics();
      setProfile(profile ? { ...profile, status: "free" } : null);
      loadDashboard();
      // Clear the protection after 10s (any in-flight response will have arrived by then)
      setTimeout(() => { completedOrderIdRef.current = null; }, 10000);
    } else {
      // Clear isWaiting when trip starts — otherwise the GPS odometer block
      // (!isWaiting condition) stays blocked and distance never accumulates.
      const patch = status === "in_progress"
        ? { ...activeOrder, status, isWaiting: false, waitingStartedAt: null }
        : { ...activeOrder, status };
      setActiveOrder(patch);
      if (status === "in_progress" && !activeOrder.isFixedPrice) {
        void (async () => {
          // ── Synchronous path (server returned rates in PATCH response) ──────
          // Same as curbside: rates are ready from second 1, no async getTripRates needed.
          const serverSessionId = res.data?._sessionId ?? null;
          const serverBaseFare  = Number(res.data?._baseFare)      || useDriverStore.getState().tripBaseFare;
          const serverCityRate  = Number(res.data?._cityRate)       || Number(activeOrder.pricePerKm) || 80;
          const serverOutRate   = Number(res.data?._outOfCityRate)  || 0;

          if (serverSessionId) {
            // Inject session + rates synchronously — no /trip/start call needed
            await injectSessionId(activeOrder.id, serverSessionId, serverBaseFare, serverCityRate, serverOutRate);
            const store = useDriverStore.getState();
            store.setTripBaseFare(serverBaseFare);
            store.setTripCityRate(serverCityRate);
            if (serverOutRate > 0) store.setConfiguredOutOfCityRate(serverOutRate);
            const currentDist = store.tripDistance;
            store.setTripMeter(currentDist, roundTo5(serverBaseFare + currentDist * serverCityRate));
          } else {
            // ── Fallback: offline or server didn't return rates ────────────────
            await startTripSync(activeOrder.id);
            const rates = await getTripRates(activeOrder.id);
            if (rates) {
              const store = useDriverStore.getState();
              store.setTripBaseFare(rates.effectiveBaseFare);
              store.setTripCityRate(rates.effectiveCityRatePerKm);
              if (rates.outOfCityKmRate > 0) store.setConfiguredOutOfCityRate(rates.outOfCityKmRate);
              const currentDist = store.tripDistance;
              store.setTripMeter(currentDist, roundTo5(rates.effectiveBaseFare + currentDist * rates.effectiveCityRatePerKm));
            }
          }

          // Store out-of-city rate for client-side zone detection in GPS task
          if (serverOutRate > 0) {
            useDriverStore.getState().setConfiguredOutOfCityRate(serverOutRate);
          }

          // Fetch city boundary GeoJSON once (cached in store across trips)
          if (!useDriverStore.getState().cityBoundary) {
            try {
              const resp = await fetch(`${API_BASE}/api/geozones`);
              const geoData: any[] = await resp.json();
              const boundary = geoData.find((z) => z.type === "city_boundary" && z.isActive && z.geojson);
              if (boundary?.geojson?.coordinates?.[0]) {
                useDriverStore.getState().setCityBoundary(boundary.geojson.coordinates[0]);
              }
            } catch { /* non-critical — GPS fallback still works via server zone detection */ }
          }

          try {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
            const seedPoint = {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              capturedAt: new Date(loc.timestamp).toISOString(),
              accuracyM: typeof loc.coords.accuracy === "number" ? loc.coords.accuracy : null,
              speedKmh:
                typeof loc.coords.speed === "number" && Number.isFinite(loc.coords.speed)
                  ? loc.coords.speed * 3.6
                  : null,
              headingDeg:
                typeof loc.coords.heading === "number" && Number.isFinite(loc.coords.heading)
                  ? loc.coords.heading
                  : null,
            };
            useDriverStore.getState().setLastLocation({ lat: seedPoint.lat, lng: seedPoint.lng });
            await queueTripPoint(activeOrder.id, seedPoint);
          } catch {
            // Ignore seed GPS errors — background tracking will continue.
          }
        })();
      }
    }
  };

  const callClient = () => {
    if (activeOrder?.phone) {
      Linking.openURL(`tel:${activeOrder.phone}`);
    }
  };

  const openNavigator = () => {
    if (!activeOrder) return;

    // Smart destination: pickup when going to client, dropoff when carrying client
    const goingToDropoff =
      (activeOrder.status === "arrived" || activeOrder.status === "in_progress") &&
      activeOrder.dropoffPoint;

    const targetCoords = goingToDropoff
      ? parseWktPoint(activeOrder.dropoffPoint)
      : parseWktPoint(activeOrder.pickupPoint);

    const targetAddress = goingToDropoff
      ? (activeOrder.dropoffAddress || "")
      : (activeOrder.pickupAddress || "");

    if (targetCoords) {
      const { latitude: lat, longitude: lng } = targetCoords;
      // Include driver current location as "from" point so navigator doesn't ask
      const fromPart = currentCoords
        ? `&lat_from=${currentCoords.latitude}&lon_from=${currentCoords.longitude}`
        : "";
      const deepLink = `yandexnavi://build_route_on_map?lat_to=${lat}&lon_to=${lng}${fromPart}&zoom=15`;
      const webFallback = currentCoords
        ? `https://yandex.ru/maps/?rtext=${currentCoords.latitude},${currentCoords.longitude}~${lat},${lng}&rtt=auto`
        : `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`;

      Linking.canOpenURL(deepLink).then((canOpen) => {
        Linking.openURL(canOpen ? deepLink : webFallback);
      });
    } else if (targetAddress) {
      const encoded = encodeURIComponent(targetAddress);
      const webUrl = `https://yandex.ru/maps/?text=${encoded}&rtt=auto`;
      Linking.openURL(webUrl);
    } else {
      Alert.alert("Навигатор", "Адрес назначения не указан");
    }
  };

  const tripElapsed = tripStartTime ? Math.floor((Date.now() - tripStartTime) / 60000) : 0;

  const [waitingElapsed, setWaitingElapsed] = useState(0);
  const [tripWaitingElapsed, setTripWaitingElapsed] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeOrder && activeOrder.status === "arrived") {
      interval = setInterval(() => {
        if (activeOrder.arrivedAt) {
          const elapsed = Math.floor((Date.now() - new Date(activeOrder.arrivedAt).getTime()) / 1000);
          setWaitingElapsed(Math.max(0, elapsed));
        } else {
          setWaitingElapsed((prev) => prev + 1);
        }
      }, 1000);
    } else {
      setWaitingElapsed(0);
    }
    return () => clearInterval(interval);
  }, [activeOrder]);

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;

    const updateTripWaitingElapsed = () => {
      if (!activeOrder?.isWaiting) {
        setTripWaitingElapsed(Number(activeOrder?.waitingAccumulatedSeconds) || 0);
        return;
      }

      const waitingStartedAt = activeOrder.waitingStartedAt
        ? new Date(activeOrder.waitingStartedAt).getTime()
        : Date.now();
      const currentSeconds = Math.max(0, Math.floor((Date.now() - waitingStartedAt) / 1000));
      setTripWaitingElapsed((Number(activeOrder.waitingAccumulatedSeconds) || 0) + currentSeconds);
    };

    if (activeOrder?.status === "in_progress") {
      updateTripWaitingElapsed();
      if (activeOrder.isWaiting) {
        interval = setInterval(updateTripWaitingElapsed, 1000);
      }
    } else {
      setTripWaitingElapsed(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [
    activeOrder?.isWaiting,
    activeOrder?.status,
    activeOrder?.waitingAccumulatedSeconds,
    activeOrder?.waitingStartedAt,
  ]);

  const WAITING_RATE_PER_MIN = 20;
  const tripWaitingFee = Math.floor(tripWaitingElapsed / 60) * WAITING_RATE_PER_MIN;

  // Real-time out-of-city time surcharge (+25₸/мин) — updates every 15 sec independently from GPS
  const [outOfCityTimeFee, setOutOfCityTimeFee] = useState(0);
  useEffect(() => {
    if (activeOrder?.status !== "in_progress") {
      setOutOfCityTimeFee(0);
      return;
    }
    const calcFee = () => {
      // Total = accumulated seconds from past out-of-city periods + current period (if still out)
      const accSec = useDriverStore.getState().outOfCityAccumulatedSeconds;
      const currentSec = isOutOfCity && outOfCityStartTime
        ? Math.floor((Date.now() - outOfCityStartTime) / 1000)
        : 0;
      setOutOfCityTimeFee(Math.floor((accSec + currentSec) / 60) * 25);
    };
    calcFee();
    const interval = setInterval(calcFee, 15000);
    return () => clearInterval(interval);
  }, [isOutOfCity, outOfCityStartTime, activeOrder?.status]);

  const displayedTripPrice = activeOrder?.isFixedPrice
    ? (activeOrder?.estimatedPrice ?? 0) + tripWaitingFee
    : tripPrice + tripWaitingFee + outOfCityTimeFee;
  const renderHome = () => {
    if (!profile) {
      return (
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Загрузка...</Text>
        </View>
      );
    }

    if (activeOrder) {
      const isInProgress = activeOrder.status === "in_progress";
      const isPaused = isInProgress && !!activeOrder.isWaiting;

      return (
        <View style={{ flex: 1 }}>
          {/* ── 1. Full-screen Map ──────────────────────────────────────── */}
          <YandexMapView
            ref={mapRef}
            userLocation={currentCoords}
            userHeading={currentHeading}
            pickupLocation={parseWktPoint(activeOrder.pickupPoint)}
            dropoffLocation={parseWktPoint(activeOrder.dropoffPoint)}
            autoFollow={activeOrder.status === "in_progress"}
            zoom={15}
            showCenterButton={false}
          />

          {/* ── 2. Top Header (Floating, transparent dark) ──────────────── */}
          {isPaused ? (
            // Баннер паузы
            <TouchableOpacity
              style={[styles.floatingPauseBanner, { top: insets.top + 10 }]}
              onPress={() => toggleTripWaiting("stop")}
              activeOpacity={0.85}
              disabled={loading}
            >
              <View style={styles.pauseBannerLeft}>
                <Ionicons name="pause-circle" size={36} color="#FFD000" />
                <View>
                  <Text style={styles.pauseBannerTitle}>ПАУЗА</Text>
                  <Text style={styles.pauseBannerSub}>
                    {Math.floor(tripWaitingElapsed / 60)}:{(tripWaitingElapsed % 60).toString().padStart(2, "0")}
                    {"  "}+{tripWaitingFee} ₸
                  </Text>
                </View>
              </View>
              <View style={styles.pauseResumeBtn}>
                <Ionicons name="play" size={20} color="#000" />
                <Text style={styles.pauseResumeBtnText}>Снять</Text>
              </View>
            </TouchableOpacity>
          ) : (
            // Стандартный хедер активного заказа
            <View style={[styles.floatingOrderHeader, { top: insets.top + 10 }]}>
              <View style={styles.floatingOrderHeaderLeft}>
                <Text style={styles.floatingOrderHeaderTitle}>Заказ №{activeOrder.id}</Text>
                
                <TouchableOpacity
                  style={styles.gpsBadgeSmall}
                  onPress={refreshCurrentPosition}
                  disabled={refreshingGPS}
                >
                  {refreshingGPS
                    ? <ActivityIndicator size={10} color="#fff" />
                    : <Ionicons name="locate" size={10} color="#fff" />}
                  <Text style={styles.gpsBadgeSmallText}>GPS</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.floatingOrderMenuBtn}
                onPress={() => Alert.alert("Действия", "", [
                  {
                    text: "Отменить заказ",
                    style: "destructive",
                    onPress: () => Alert.alert("Отменить заказ?", "Это действие нельзя отменить", [
                      { text: "Нет", style: "cancel" },
                      { text: "Да, отменить", style: "destructive", onPress: () => updateOrderStatus("canceled") },
                    ]),
                  },
                  { text: "Закрыть", style: "cancel" },
                ])}
              >
                <Ionicons name="ellipsis-vertical" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* ── Status pill ─────────────────────────────────────────────── */}
          {/* Removed: status text now clear from bottom sheet */}

          {/* ── Payment pill ────────────────────────────────────────────── */}
          {/* Removed: payment info now in bottom sheet */}

          {/* ── Накопленное ожидание (если есть) ────────────────────────── */}
          {!isPaused && !activeOrder.isWaiting && tripWaitingElapsed > 0 && (
             <View style={[styles.floatingMapWaitingOverlay, { top: insets.top + 94 }]} >
                <Ionicons name="time-outline" size={12} color="#e0c84a" />
                <Text style={styles.mapWaitingText}>+{tripWaitingFee} ₸</Text>
             </View>
          )}

          {/* ── Map controls — right side (Centered) ───────────────────────────────── */}
          <View style={[styles.floatingMapControls, { top: '50%', marginTop: -60 }]}>
            <TouchableOpacity style={styles.floatingMapBtn} onPress={() => mapRef.current?.zoomIn()}>
              <Ionicons name="add" size={22} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.floatingMapBtn} onPress={() => mapRef.current?.zoomOut()}>
              <Ionicons name="remove" size={22} color="#333" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.floatingMapBtn} onPress={async () => { await refreshCurrentPosition(); mapRef.current?.centerOnMe(); }}>
              <Ionicons name="locate" size={20} color="#333" />
            </TouchableOpacity>
          </View>

          {/* ── Bottom Sheet Card ───────────────────────────────────────── */}
          <View style={[styles.bottomSheetCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.bottomSheetHeader}>
              <View style={styles.bottomSheetAddressBlock}>
                {/* Откуда */}
                <View style={styles.bottomSheetAddressLine}>
                  <View style={[styles.dotLine, { backgroundColor: '#22c55e' }]} />
                  <Text style={styles.bottomSheetAddressText} numberOfLines={1}>
                    {activeOrder.pickupAddress || "Адрес не указан"}
                  </Text>
                </View>
                
                {/* Куда */}
                {activeOrder.isFixedPrice && activeOrder.dropoffAddress && (
                  <View style={styles.bottomSheetAddressLine}>
                    <View style={[styles.dotLine, { backgroundColor: '#3b82f6' }]} />
                    <Text style={styles.bottomSheetAddressText} numberOfLines={1}>
                      {activeOrder.dropoffAddress}
                    </Text>
                  </View>
                )}

                {/* Ожидание (клиент думает) */}
                {activeOrder.status === "arrived" && waitingElapsed > 0 && (
                  <Text style={{ fontSize: 13, color: waitingElapsed > 180 ? "#ef4444" : "#888", marginTop: 4, marginLeft: 20 }}>
                    {waitingElapsed > 180
                      ? `Платное: ${Math.floor((waitingElapsed - 180) / 60) * 20} ₸ (${Math.floor(waitingElapsed / 60)} мин)`
                      : `Ожидание: ${Math.floor(waitingElapsed / 60)}:${(waitingElapsed % 60).toString().padStart(2, "0")} (Беспл.)`}
                  </Text>
                )}
              </View>

              {/* Кнопки Навигатор и Телефон */}
              <View style={styles.bottomSheetActionsRow}>
                <TouchableOpacity style={[styles.bottomSheetCircleBtn, { backgroundColor: '#f1f5f9' }]} onPress={callClient}>
                  <Ionicons name="call" size={20} color="#333" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.bottomSheetCircleBtn, { backgroundColor: '#333' }]} onPress={openNavigator}>
                  <Ionicons name="navigate" size={20} color="#FFD000" />
                </TouchableOpacity>
                
                {/* Кнопка Паузы (только во время поездки) */}
                {isInProgress && !isPaused && (
                  <TouchableOpacity style={[styles.bottomSheetCircleBtn, { backgroundColor: '#FFD000' }]} onPress={() => toggleTripWaiting("start")}>
                    <Ionicons name="pause" size={20} color="#000" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Опции */}
            {Array.isArray(activeOrder.options) && activeOrder.options.length > 0 && (
              <View style={styles.bottomSheetOptions}>
                {activeOrder.options.map((opt: any) => {
                  const key = typeof opt === "string" ? opt : opt.key;
                  const label = opt.label || (key === "luggage" ? "Багаж" : key === "roof_luggage" ? "Верх. Багаж" : key === "conditioner" ? "Кондиционер" : "Опция");
                  const price = opt.price || (key === "luggage" ? 100 : key === "roof_luggage" ? 200 : key === "conditioner" ? 100 : 0);
                  return (
                    <View key={key} style={styles.optionTag}>
                      <Ionicons name={key === "luggage" ? "briefcase" : key === "roof_luggage" ? "cube" : key === "conditioner" ? "snow" : "apps-outline"} size={10} color="#fff" />
                      <Text style={styles.optionTagText}>{label} (+{price})</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Метрика / Цена */}
            {isInProgress && (
              <View style={styles.bottomSheetMeter}>
                {activeOrder.isFixedPrice ? (
                  <>
                    <Text style={styles.meterStripLabel}>Фиксированная цена</Text>
                    <Text style={styles.meterStripPrice}>{displayedTripPrice} ₸</Text>
                  </>
                ) : (
                  <>
                    <View style={styles.meterStripItem}>
                      <Ionicons name="speedometer-outline" size={16} color="#888" />
                      <Text style={styles.meterStripValue}>{tripDistance.toFixed(1)} км</Text>
                    </View>
                    <View style={styles.meterStripItem}>
                      <Ionicons name="time-outline" size={16} color="#888" />
                      <Text style={styles.meterStripValue}>{tripElapsed} мин</Text>
                    </View>
                    <Text style={styles.meterStripPrice}>{displayedTripPrice} ₸</Text>
                  </>
                )}
              </View>
            )}

            {/* Swipe Action */}
            <View style={styles.bottomSheetSwipeArea}>
              {activeOrder.status === "assigned" && (
                <SwipeButton title="Я на месте" onSwipeComplete={() => updateOrderStatus("arrived")} color="#FFD000" iconName="navigate" disabled={loading} />
              )}
              {activeOrder.status === "arrived" && (
                <SwipeButton title="Клиент сел — поехали" onSwipeComplete={() => updateOrderStatus("in_progress")} color="#FFD000" iconName="car" disabled={loading} />
              )}
              {isInProgress && (
                <SwipeButton title="Завершить поездку" onSwipeComplete={() => updateOrderStatus("completed")} color="#cb1111" textColor="#fff" thumbColor="#fff" iconColor="#cb1111" iconName="checkmark-circle" disabled={loading} />
              )}
            </View>
          </View>
        </View>
      );
    }

    // ── Level helpers ──────────────────────────────────────────────────────
    const lvlColor = profile.level === 'gold' ? '#FFD700' : profile.level === 'silver' ? '#94A3B8' : profile.level === 'blocked' ? '#EF4444' : '#CD7F32';
    const lvlEmoji = { gold: '🥇', silver: '🥈', bronze: '🥉', blocked: '🚫' }[profile.level] ?? '🥉';

    return (
      <View style={{ flex: 1 }}>

        {/* ── Full-screen map ─────────────────────────────────────────── */}
        <YandexMapView
          ref={mapRef}
          userLocation={currentCoords}
          userHeading={currentHeading}
          zoom={15}
          showCenterButton={false}
        />

        {/* ── Floating top bar ──────────────────────────────────────── */}
        <View style={[styles.floatingTopBar, { paddingTop: insets.top + 10 }]}>
          {/* Status pill */}
          <View style={[styles.statusPill, isOnline ? styles.statusPillOnline : styles.statusPillOffline]}>
            <View style={[styles.statusDot, isOnline ? styles.dotOnline : styles.dotOffline]} />
            <Text style={styles.statusPillText}>{isOnline ? 'На линии' : 'Вне линии'}</Text>
          </View>

          <View style={{ flex: 1 }} />

          {/* Balance + orders card */}
          <View style={styles.floatingBalanceCard}>
            <Text style={styles.floatingBalanceVal}>{Number(profile.balance).toLocaleString()} ₸</Text>
            <Text style={styles.floatingBalanceSub}>{Number(profile.ordersCount || 0)} заказов</Text>
          </View>

          {/* Level badge */}
          <View style={[styles.floatingLevelBadge, { borderColor: lvlColor }]}>
            <Text style={{ fontSize: 20 }}>{lvlEmoji}</Text>
          </View>
        </View>

        {/* ── Бордюр (curbside) button — top left ────────────────────── */}
        {isOnline && profile?.status === 'free' && (
          <TouchableOpacity
            style={[styles.floatingCurbsideBtn, { top: insets.top + 72 }]}
            onLongPress={() => { Vibration.vibrate(80); handleCurbsideOrder(); }}
            delayLongPress={1200}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Ionicons name="car-sport" size={18} color="#000" />
            <Text style={styles.floatingCurbsideText}>Бордюр</Text>
          </TouchableOpacity>
        )}

        {/* ── Map controls — right side (Centered) ────────────────────────────── */}
        <View style={[styles.floatingMapControls, { top: '50%', marginTop: -60 }]}>
          <TouchableOpacity style={styles.floatingMapBtn} onPress={() => mapRef.current?.zoomIn()}>
            <Ionicons name="add" size={22} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.floatingMapBtn} onPress={() => mapRef.current?.zoomOut()}>
            <Ionicons name="remove" size={22} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.floatingMapBtn} onPress={() => mapRef.current?.centerOnMe()}>
            <Ionicons name="locate" size={20} color="#333" />
          </TouchableOpacity>
        </View>

        {/* ── Menu button — bottom left ────────────────────────────── */}
        <TouchableOpacity
          style={[styles.floatingMenuBtn, { top: '50%', marginTop: -20 }]}
          onPress={() => setMenuOpen(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="menu" size={24} color="#fff" />
        </TouchableOpacity>

        {/* ── Swipe button — bottom ────────────────────────────────── */}
        <View style={[styles.floatingSwipeBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <SwipeButton
            title={togglingOnline ? 'Подключение...' : isOnline ? 'Уйти с линии' : 'Выйти на линию'}
            onSwipeComplete={toggleOnline}
            color={isOnline ? '#cb1111ff' : '#FFD000'}
            textColor={isOnline ? '#fff' : '#000'}
            thumbColor={isOnline ? '#fff' : '#000'}
            iconColor={isOnline ? '#cb1111ff' : '#FFD000'}
            iconName={isOnline ? 'power' : 'flash'}
            disabled={loading || togglingOnline}
          />
        </View>

        {/* ── Slide-in menu panel ───────────────────────────────────── */}
        {menuOpen && (
          <View style={styles.menuOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
            <View style={[styles.menuPanel, { paddingBottom: Math.max(insets.bottom, 20) }]}>
              <Text style={styles.menuTitle}>{profile.lastName || profile.firstName || 'Водитель'} {profile.lastName ? profile.firstName ?? '' : ''}</Text>
              <Text style={styles.menuSub}>{lvlEmoji} {({ gold: 'Золото', silver: 'Серебро', bronze: 'Бронза', blocked: 'Заблокирован' } as any)[profile.level] ?? 'Бронза'}</Text>
              <View style={styles.menuDivider} />
              {[
                { icon: 'receipt-outline', label: 'Активные заказы', tab: 'orders' },
                { icon: 'list', label: 'История', tab: 'history' },
                { icon: 'chatbubble-ellipses', label: 'Чат', tab: 'chat' },
                { icon: 'person', label: 'Профиль', tab: 'profile' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.tab}
                  style={styles.menuItem}
                  onPress={() => { setMenuOpen(false); setActiveTab(item.tab as DriverTab); }}
                >
                  <Ionicons name={item.icon as any} size={22} color="#FFD000" />
                  <Text style={styles.menuItemText}>{item.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#555" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case "orders":  return <ActiveOrdersPanel />;
      case "history": return <DriverHistoryPanel />;
      case "chat":    return <DriverChatPanel />;
      case "profile": return <DriverProfilePanel />;
      default:        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* Home screen (map) always mounted — display:none hides without unmounting.
          This preserves WebView state so map position is never lost on tab switch. */}
      <View style={activeTab === 'home' ? styles.contentArea : styles.tabHidden}>
        {renderHome()}
      </View>

      {/* Other tabs rendered as overlay when active */}
      {activeTab !== 'home' && (
        <View style={styles.contentArea}>
          {renderActiveTab()}
        </View>
      )}

      {/* Back-to-map button when a non-home tab is active */}
      {activeTab !== 'home' && (
        <TouchableOpacity
          style={[styles.backToMapBtn, { bottom: Math.max(insets.bottom, 16) + 8 }]}
          onPress={() => setActiveTab('home')}
          activeOpacity={0.85}
        >
          <Ionicons name="map" size={18} color="#000" />
          <Text style={styles.backToMapText}>Карта</Text>
        </TouchableOpacity>
      )}

      {/* ─── Trip Summary Modal ──────────────────────────────────────────── */}
      <Modal visible={!!tripSummary} transparent animationType="fade" onRequestClose={() => setTripSummary(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.summaryCard}>
            {/* Header */}
            <View style={styles.summaryHeader}>
              <Ionicons name="checkmark-circle" size={32} color="#22c55e" />
              <Text style={styles.summaryTitle}>ПОЕЗДКА ЗАВЕРШЕНА</Text>
            </View>

            {/* Distance */}
            {tripSummary?.distanceKm != null && (
              <Text style={styles.summaryDistance}>
                Расстояние: {Number(tripSummary.distanceKm).toFixed(1)} км
              </Text>
            )}

            {/* Breakdown divider */}
            <View style={styles.summaryDivider} />
            <Text style={styles.summaryBreakdownTitle}>Детализация</Text>

            {tripSummary?.breakdown ? (
              <View style={styles.summaryRows}>
                {/* Base fare */}
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryRowLabel}>Подача</Text>
                  <Text style={styles.summaryRowValue}>{tripSummary.breakdown.baseFare} ₸</Text>
                </View>

                {/* City km */}
                {tripSummary.breakdown.cityKm > 0 && (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryRowLabel}>
                      Город: {Number(tripSummary.breakdown.cityKm).toFixed(1)} км × {tripSummary.breakdown.cityRatePerKm} ₸/км
                    </Text>
                    <Text style={styles.summaryRowValue}>
                      {Math.round(tripSummary.breakdown.cityKm * tripSummary.breakdown.cityRatePerKm)} ₸
                    </Text>
                  </View>
                )}

                {/* Out-of-city km — only if drove outside city */}
                {tripSummary.breakdown.outOfCityKm > 0 && (
                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryRowLabel, styles.summaryOutLabel]}>
                      Загород: {Number(tripSummary.breakdown.outOfCityKm).toFixed(1)} км × {tripSummary.breakdown.outOfCityKmRate} ₸/км
                    </Text>
                    <Text style={[styles.summaryRowValue, styles.summaryOutValue]}>
                      {Math.round(tripSummary.breakdown.outOfCityKm * tripSummary.breakdown.outOfCityKmRate)} ₸
                    </Text>
                  </View>
                )}

                {/* Out-of-city time fee */}
                {tripSummary.breakdown.outOfCitySeconds > 0 && (
                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryRowLabel, styles.summaryOutLabel]}>
                      Время за городом: {Math.floor(tripSummary.breakdown.outOfCitySeconds / 60)} мин × 25 ₸/мин
                    </Text>
                    <Text style={[styles.summaryRowValue, styles.summaryOutValue]}>
                      {Math.floor(tripSummary.breakdown.outOfCitySeconds / 60) * 25} ₸
                    </Text>
                  </View>
                )}

                {/* Waiting fee */}
                {(tripSummary.waitingFee > 0) && (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryRowLabel}>
                      Ожидание: {Math.floor(tripSummary.waitingAccumulatedSeconds / 60)} мин × 20 ₸/мин
                    </Text>
                    <Text style={styles.summaryRowValue}>{tripSummary.waitingFee} ₸</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.summaryRows}>
                <Text style={styles.summaryRowLabel}>Данные поездки загружаются...</Text>
              </View>
            )}

            {/* Total */}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryTotalRow}>
              <Text style={styles.summaryTotalLabel}>ИТОГО</Text>
              <Text style={styles.summaryTotalValue}>{tripSummary?.finalPrice} ₸</Text>
            </View>

            {/* Close button */}
            <TouchableOpacity
              style={styles.summaryCloseBtn}
              onPress={() => setTripSummary(null)}
              activeOpacity={0.8}
            >
              <Text style={styles.summaryCloseBtnText}>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Force Update Modal ──────────────────────────────────────────── */}
      <Modal visible={!!forceUpdateModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.summaryCard, { alignItems: "center", gap: 12 }]}>
            <Text style={{ fontSize: 40 }}>🚀</Text>
            <Text style={[styles.summaryTotalLabel, { color: "#FFD000", fontSize: 18 }]}>
              Доступно обновление
            </Text>
            <Text style={{ color: "#aaa", textAlign: "center", lineHeight: 20 }}>
              {forceUpdateModal?.message}
            </Text>
            {forceUpdateModal?.downloadUrl && (
              <TouchableOpacity
                style={[styles.summaryCloseBtn, { backgroundColor: "#FFD000", marginTop: 8 }]}
                onPress={() => Linking.openURL(forceUpdateModal!.downloadUrl!)}
                activeOpacity={0.8}
              >
                <Text style={[styles.summaryCloseBtnText, { color: "#111" }]}>
                  Скачать обновление
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.summaryCloseBtn, { backgroundColor: "#333", marginTop: 4 }]}
              onPress={() => setForceUpdateModal(null)}
              activeOpacity={0.8}
            >
              <Text style={styles.summaryCloseBtnText}>Позже</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Order Alert Modal ───────────────────────────────────────────── */}
      <Modal visible={!!orderAlert} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.alertCard}>
            <View style={styles.alertHeader}>
              <Ionicons name="notifications" size={28} color="#FFD000" />
              <Text style={styles.alertTitle}>НОВЫЙ ЗАКАЗ!</Text>
            </View>

            <View style={styles.alertBody}>
              <View style={styles.alertRow}>
                <Ionicons name="location" size={18} color="#FFD000" />
                <Text style={styles.alertText}>{orderAlert?.pickupAddress || "Адрес не указан"}</Text>
              </View>
              <View style={styles.alertRow}>
                <Ionicons name="call" size={18} color="#FFD000" />
                <Text style={styles.alertText}>{orderAlert?.phone ? `${orderAlert.phone.slice(0, 8)}***` : "—"}</Text>
              </View>
              <View style={styles.alertRow}>
                <Ionicons name="speedometer" size={18} color="#FFD000" />
                <Text style={styles.alertText}>{orderAlert?.pricePerKm || 80} ₸/км</Text>
              </View>
            </View>

            <View style={styles.timerCircle}>
              <Text style={styles.timerText}>{alertTimer}</Text>
            </View>

            <View style={styles.alertActions}>
              <TouchableOpacity style={[styles.alertBtn, { backgroundColor: "#00cb07ff" }]} onPress={acceptOrder} disabled={loading}>
                <Ionicons name="checkmark" size={24} color="#fff" />
                <Text style={styles.alertBtnText}>Принять</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.alertBtn, { backgroundColor: "#d2291dff" }]} onPress={rejectOrder}>
                <Ionicons name="close" size={24} color="#fff" />
                <Text style={styles.alertBtnText}>Отклонить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Dispatcher Assignment Modal ── */}
      <Modal visible={!!dispatcherAssignedOrder} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.alertCard, { borderColor: "#0984e3", borderWidth: 2 }]}>
            <View style={styles.alertHeader}>
              <Ionicons name="person" size={28} color="#0984e3" />
              <Text style={[styles.alertTitle, { color: "#0984e3" }]}>ДИСПЕТЧЕР</Text>
            </View>

            <Text style={{ color: "#ccc", fontSize: 13, textAlign: "center", marginBottom: 14 }}>
              Вам назначили заказ №{dispatcherAssignedOrder?.id}
            </Text>

            <View style={styles.alertBody}>
              <View style={styles.alertRow}>
                <Ionicons name="location" size={18} color="#0984e3" />
                <Text style={styles.alertText}>
                  {dispatcherAssignedOrder?.pickupAddress || "Адрес не указан"}
                </Text>
              </View>
              {dispatcherAssignedOrder?.dropoffAddress && (
                <View style={styles.alertRow}>
                  <Ionicons name="flag" size={18} color="#0984e3" />
                  <Text style={styles.alertText}>{dispatcherAssignedOrder.dropoffAddress}</Text>
                </View>
              )}
              <View style={styles.alertRow}>
                <Ionicons name="call" size={18} color="#0984e3" />
                <Text style={styles.alertText}>
                  {dispatcherAssignedOrder?.phone
                    ? `${dispatcherAssignedOrder.phone.slice(0, 8)}***`
                    : "—"}
                </Text>
              </View>
              {/* Цена: фиксированная или по счётчику */}
              {dispatcherAssignedOrder?.isFixedPrice ? (
                <View style={styles.alertRow}>
                  <Ionicons name="pricetag" size={18} color="#22c55e" />
                  <Text style={[styles.alertText, { fontWeight: "700", color: "#22c55e", fontSize: 16 }]}>
                    Фикс: {dispatcherAssignedOrder.estimatedPrice} ₸
                  </Text>
                </View>
              ) : (
                <View style={styles.alertRow}>
                  <Ionicons name="speedometer" size={18} color="#FFD000" />
                  <Text style={[styles.alertText, { fontWeight: "700", color: "#FFD000", fontSize: 16 }]}>
                    Счётчик: {dispatcherAssignedOrder?.pricePerKm || 80} ₸/км
                  </Text>
                </View>
              )}
              {dispatcherAssignedOrder?.comment ? (
                <View style={styles.alertRow}>
                  <Ionicons name="chatbubble-ellipses" size={18} color="#888" />
                  <Text style={[styles.alertText, { color: "#aaa" }]}>{dispatcherAssignedOrder.comment}</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.alertActions, { marginTop: 16 }]}>
              <TouchableOpacity
                style={[styles.alertBtn, { backgroundColor: "#0984e3", flex: 1 }]}
                onPress={() => {
                  setDispatcherAssignedOrder(null);
                  setActiveTab("home");
                }}
              >
                <Ionicons name="checkmark-circle" size={24} color="#fff" />
                <Text style={styles.alertBtnText}>Понял, принял</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── Layout ───────────────────────────────────────────────
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  contentArea: { flex: 1 },
  tabHidden: { flex: 1, display: 'none' },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0a0a0a" },
  loadingText: { color: "#666", fontSize: 16 },
  pageBlock: { flex: 1, paddingHorizontal: 16, paddingBottom: 90, overflow: "hidden" },

  // ─── Floating home UI (Phase 3 — map-first) ───────────────
  floatingTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 10, gap: 8,
    backgroundColor: 'rgba(0,0,0,0.0)',
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    backgroundColor: 'rgba(20,20,20,0.85)',
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  statusPillOnline: { borderColor: '#22c55e33' },
  statusPillOffline: { borderColor: '#ef444433' },
  statusPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  floatingBalanceCard: {
    backgroundColor: 'rgba(15,15,15,0.9)',
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7,
    alignItems: 'flex-end', borderWidth: 1, borderColor: '#222',
  },
  floatingBalanceVal: { color: '#fff', fontSize: 15, fontWeight: '800' },
  floatingBalanceSub: { color: '#555', fontSize: 10, fontWeight: '600' },
  floatingLevelBadge: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(15,15,15,0.9)',
    borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center',
  },
  floatingCurbsideBtn: {
    position: 'absolute', left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFD000', borderRadius: 22,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35, shadowRadius: 6, elevation: 6,
  },
  floatingCurbsideText: { color: '#000', fontWeight: '800', fontSize: 13 },
  floatingMapControls: {
    position: 'absolute', right: 12,
    gap: 8,
  },
  floatingMapBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.92)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 4,
  },
  floatingMenuBtn: {
    position: 'absolute', left: 12,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(20,20,20,0.92)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#333',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4, shadowRadius: 6, elevation: 6,
  },
  floatingSwipeBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: 'rgba(10,10,10,0.85)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: '#1e1e1e',
  },

  // ─── Slide-in menu panel ──────────────────────────────────
  menuOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 200, justifyContent: 'flex-end' },
  menuPanel: {
    backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 20, paddingHorizontal: 20,
    borderTopWidth: 1, borderColor: '#2a2a2a',
  },
  menuTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 2 },
  menuSub: { color: '#888', fontSize: 13, marginBottom: 16 },
  menuDivider: { height: 1, backgroundColor: '#1e1e1e', marginBottom: 12 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  menuItemText: { color: '#e0e0e0', fontSize: 15, fontWeight: '600', flex: 1 },

  // ─── Back to map button ───────────────────────────────────
  backToMapBtn: {
    position: 'absolute', right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFD000', borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  backToMapText: { color: '#000', fontWeight: '800', fontSize: 13 },

  // ─── Header (waiting) ─────────────────────────────────────
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingTop: 4 },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: 0.3 },
  headerRate: { color: "#FFD000", fontSize: 17, fontWeight: "700" },

  // ─── GPS badge (top right in waiting) ─────────────────────
  gpsBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1c1c1c", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#2a2a2a" },
  gpsBadgeText: { color: "#aaa", fontSize: 12, fontWeight: "600" },

  // ─── Online dot ───────────────────────────────────────────
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotOnline: { backgroundColor: "#22c55e", shadowColor: "#22c55e", shadowOpacity: 0.8, shadowRadius: 4, elevation: 4 },
  dotOffline: { backgroundColor: "#ef4444" },

  // ─── Stats row ────────────────────────────────────────────
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: "#161616", borderRadius: 14, padding: 12, alignItems: "center", borderWidth: 1, borderColor: "#222" },
  statLabel: { color: "#555", fontSize: 9, marginBottom: 4, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { color: "#fff", fontSize: 15, fontWeight: "800" },

  // ─── (GPS status card replaced by map) ───────────────────

  // ─── Order header ─────────────────────────────────────────
  orderHeader: { flexDirection: "row", alignItems: "center", gap: 0, marginBottom: 10, paddingTop: 3 },
  orderHeaderTitle: { color: "#fff", fontSize: 17, flex: 1, paddingTop: 10, fontWeight: "800" },
  menuBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#161616", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#222" },

  // ─── Address strip ────────────────────────────────────────
  addressStrip: { backgroundColor: "#111", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, gap: 10, borderWidth: 1, borderColor: "#1e1e1e" },
  addressLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  addressLineText: { color: "#e0e0e0", fontSize: 19, flex: 1, lineHeight: 25, marginTop: 4, fontWeight: "700" },
  phoneText: { color: "#e0e0e0", fontSize: 19, flex: 1, marginTop: 4, fontWeight: "700" },

  // ─── Navigator button ─────────────────────────────────────
  navBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#FFD000", borderRadius: 30,
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 10,
  },
  navBtnText: { color: "#000", fontSize: 15, fontWeight: "800", flex: 1, textAlign: "center" },

  // ─── BIG Meter strip ──────────────────────────────────────
  meterStrip: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#111", borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 18, marginBottom: 10, gap: 20,
    borderWidth: 2, borderColor: "#FFD000",
  },
  meterStripItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  meterStripLabel: { color: "#666", fontSize: 13 },
  meterStripValue: { color: "#ddd", fontSize: 18, fontWeight: "700" },
  meterStripPrice: { color: "#FFD000", fontSize: 50, fontWeight: "900", letterSpacing: -1 },

  // ─── (Status center replaced by map overlay) ─────────────
  orderActions: { position: "absolute", bottom: Platform.OS === "ios" ? 110 : 22, left: 16, right: 16 },
  curbsideStatCard: {
    backgroundColor: "#FFD000",
    borderColor: "#FFD000",
    gap: 2,
    minWidth: 62,
  },
  curbsideStatLabel: {
    color: "#000",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  curbsideStatHint: {
    color: "rgba(0,0,0,0.45)",
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  homeSwipeContainer: { position: "absolute", bottom: Platform.OS === "ios" ? 100 : 22, left: 16, right: 16 },
  statusActions: { gap: 12, marginBottom: 16 },
  statusHint: { color: "#666", fontSize: 13, textAlign: "center", marginBottom: 4 },

  // ─── Legacy (for compatibility) ───────────────────────────
  card: { backgroundColor: "#111", borderRadius: 14, padding: 16, marginBottom: 16, gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { color: "#e0e0e0", fontSize: 15, flex: 1 },
  callBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#16a34a", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  callBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  meterCard: { backgroundColor: "#111", borderRadius: 20, padding: 20, marginBottom: 16, alignItems: "center", borderWidth: 2, borderColor: "#FFD000" },
  meterRow: { flexDirection: "row", gap: 24, marginBottom: 16 },
  meterItem: { alignItems: "center" },
  meterLabel: { color: "#666", fontSize: 12, marginBottom: 4 },
  meterValue: { color: "#fff", fontSize: 22, fontWeight: "700" },
  priceLabel: { color: "#666", fontSize: 12, marginBottom: 4 },
  priceValue: { color: "#FFD000", fontSize: 52, fontWeight: "900" },
  orderBottomBar: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12, paddingVertical: 6 },
  sosChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" },
  sosChipText: { color: "#ef4444", fontSize: 12, fontWeight: "700" },
  cancelChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(80,80,80,0.1)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "rgba(80,80,80,0.2)" },
  cancelChipText: { color: "#666", fontSize: 12, fontWeight: "600" },

  // ─── Map containers (kept for safety) ────────────────────
  mapContainerWaiting: { flex: 1, borderRadius: 20, overflow: "hidden" },
  mapContainerOrder: { flex: 1, borderRadius: 16, overflow: "hidden", marginBottom: 8 },
  map: { width: "100%", height: "100%" },
  waitingOverlay: { position: "absolute", top: 12, left: 12, backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  waitingText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // ─── Bottom nav bar ───────────────────────────────────────
  navBar: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: "#505050ff", paddingVertical: 10, paddingHorizontal: 10, backgroundColor: "#0a0a0a" },
  navItem: { alignItems: "center", gap: 3 },
  navLabel: { color: "#888888ff", fontSize: 10, fontWeight: "600" },
  navLabelActive: { color: "#FFD000" },

  // ─── New order alert modal ────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", justifyContent: "center", paddingHorizontal: 20 },
  alertCard: { backgroundColor: "#111", borderRadius: 24, padding: 24, borderWidth: 2, borderColor: "#FFD000" },
  alertHeader: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 20 },
  alertTitle: { color: "#FFD000", fontSize: 24, fontWeight: "900", letterSpacing: 1 },
  alertBody: { gap: 14, marginBottom: 20 },
  alertRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  alertText: { color: "#e0e0e0", fontSize: 15, flex: 1 },
  timerCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: "#FFD000", justifyContent: "center", alignItems: "center", alignSelf: "center", marginBottom: 20, backgroundColor: "#161600" },
  timerText: { color: "#FFD000", fontSize: 28, fontWeight: "900" },
  alertActions: { flexDirection: "row", gap: 12 },
  alertBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 56, borderRadius: 14 },
  alertBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  // ─── Pause banner (top of screen when isWaiting) ──────────
  pauseBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,208,0,0.1)",
    borderWidth: 2,
    borderColor: "#FFD000",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  pauseBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pauseBannerTitle: {
    color: "#FFD000",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },
  pauseBannerSub: {
    color: "#e0c84a",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 2,
  },
  pauseResumeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFD000",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pauseResumeBtnText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "800",
  },

  // ─── Accumulated waiting badge (compact, no layout shift) ─
  waitingAccBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,208,0,0.08)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255,208,0,0.2)",
  },
  waitingAccText: {
    color: "#e0c84a",
    fontSize: 13,
    fontWeight: "600",
  },

  // ─── Pause button inside address block ────────────────────
  pauseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,208,0,0.1)",
    borderWidth: 2,
    borderColor: "#FFD000",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 10,
    marginTop: 4,
    flexShrink: 0,
  },

  // ─── Map container ────────────────────────────────────────
  mapContainer: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
    marginHorizontal: -16,
    marginBottom: 10,
  },
  mapStatusOverlay: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  mapStatusText: {
    color: "#FFD000",
    fontSize: 13,
    fontWeight: "700",
  },
  mapPaymentOverlay: {
    position: "absolute",
    bottom: 12,
    left: 12,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  mapPaymentText: {
    color: "#22c55e",
    fontSize: 11,
    fontWeight: "700",
  },
  mapWaitingOverlay: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(255,208,0,0.12)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,208,0,0.3)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  mapWaitingText: {
    color: "#e0c84a",
    fontSize: 11,
    fontWeight: "700",
  },

  // ─── Map-First Active Order Floating Styles ──────────────────────────
  floatingOrderHeader: {
    position: 'absolute',
    left: 12, right: 12,
    backgroundColor: 'rgba(26,26,46,0.85)',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  floatingOrderHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  floatingOrderHeaderTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  gpsBadgeSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  gpsBadgeSmallText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  floatingOrderMenuBtn: {
    padding: 4,
  },
  floatingPauseBanner: {
    position: 'absolute',
    left: 12, right: 12,
    backgroundColor: '#cb1111',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#cb1111',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  floatingMapStatusOverlay: {
    position: 'absolute',
    left: 12,
    backgroundColor: 'rgba(26,26,46,0.85)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  floatingMapPaymentOverlay: {
    position: 'absolute',
    right: 12,
    backgroundColor: 'rgba(26,26,46,0.85)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  floatingMapWaitingOverlay: {
    position: 'absolute',
    right: 12,
    backgroundColor: 'rgba(255,208,0,0.15)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,208,0,0.3)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bottomSheetCard: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 20,
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  bottomSheetAddressBlock: {
    flex: 1,
    gap: 8,
    marginRight: 16,
  },
  bottomSheetAddressLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dotLine: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  bottomSheetAddressText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  bottomSheetActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bottomSheetCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  bottomSheetOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  optionTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 6,
  },
  optionTagText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  bottomSheetMeter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 14,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bottomSheetSwipeArea: {
    // padding for swipe button is mostly handled by paddingBottom of bottomSheetCard
  },

  // ─── Trip Summary Modal ────────────────────────────────────────────
  summaryCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: 20,
    padding: 24,
    width: "90%",
    maxWidth: 400,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 12,
  },
  summaryTitle: {
    color: "#22c55e",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1,
  },
  summaryDistance: {
    color: "#aaa",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 4,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginVertical: 14,
  },
  summaryBreakdownTitle: {
    color: "#666",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  summaryRows: {
    gap: 10,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
  },
  summaryRowLabel: {
    color: "#ccc",
    fontSize: 13,
    flex: 1,
    flexWrap: "wrap",
    marginRight: 8,
  },
  summaryRowValue: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    minWidth: 60,
    textAlign: "right",
  },
  summaryOutLabel: {
    color: "#f59e0b",
  },
  summaryOutValue: {
    color: "#f59e0b",
  },
  summaryTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryTotalLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 1,
  },
  summaryTotalValue: {
    color: "#FFD000",
    fontSize: 26,
    fontWeight: "900",
  },
  summaryCloseBtn: {
    marginTop: 20,
    backgroundColor: "#FFD000",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  summaryCloseBtnText: {
    color: "#111",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});

