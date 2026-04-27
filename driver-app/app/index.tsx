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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, clearToken } from "../services/api";
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
import { YandexMapView, type YandexMapViewHandle } from "../components/YandexMapView";
import { mapOrderToActiveOrder } from "../lib/orderPricing";
import { clearTripSync, flushTripPoints, getTripRates, injectSessionId, queueTripPoint, startTripSync } from "../services/tripSync";

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

const LOCATION_TASK_NAME = "background-location-task";

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error("BG Task Error:", error);
    return;
  }
  if (data) {
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

      if (state.activeOrder?.status === "in_progress" && state.lastLocation && !state.activeOrder.isFixedPrice) {
        const d = haversine(state.lastLocation.lat, state.lastLocation.lng, lat, lng);

        // ✅ threshold = 10m to match backend tripDistance.ts (segKm < 0.010)
        if (d > 0.010 && d < 0.5) {
          const speedMs = typeof loc.coords.speed === "number" && Number.isFinite(loc.coords.speed)
            ? loc.coords.speed : null;
          const isStationary = speedMs !== null && speedMs < 1.0 && d < 0.015;

          if (!isStationary) {
            const newDist = state.tripDistance + d;
            const cityRate = state.tripCityRatePerKm || Number(state.activeOrder.pricePerKm) || 80;

            // ✅ FIX: tripBaseFare already includes extras (set in updateOrderStatus)
            // Do NOT add extrasTotal again here — it would double/triple count options like Bag +100
            let newPrice: number;
            if (state.isOutOfCity && state.outOfCityStartTime !== null) {
              // outOfCityTimeFee (+25₸/мин) добавляется отдельным real-time таймером в displayedTripPrice
              const distSinceZone = newDist - state.tripDistanceAtZoneChange;
              const outRate = state.outOfCityRatePerKm || cityRate;
              newPrice = roundTo5(state.tripPriceAtZoneChange + distSinceZone * outRate);
            } else {
              const baseFare = state.tripBaseFare || resolveBaseFare(
                state.activeOrder?.class,
                state.profile?.vehicle?.classes
              );
              newPrice = roundTo5(baseFare + newDist * cityRate);
            }
            useDriverStore.getState().setTripMeter(newDist, newPrice);
          }
        }
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

      // Отправляем последнюю точку на сервер
      if (state.activeOrder?.status === "in_progress" && !state.activeOrder.isFixedPrice) {
        void queueTripPoint(state.activeOrder.id, {
          lat,
          lng,
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

      // Отправляем только последнюю точку из батча — сервер сам rate-limit-ит (3 сек)
      // Для промежуточных точек достаточно trip-трекинга выше
      if (loc === locations[locations.length - 1]) {
        api("/api/driver/location", {
          method: "POST",
          body: JSON.stringify({ lat, lng }),
        }).catch(() => { });
      }
    }
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
  const [togglingOnline, setTogglingOnline] = useState(false);
  // Throttle route rebuilds during in_progress trips (max 1 per 30s)
  const routeThrottleRef = useRef<number>(0);

  // Dispatcher-assigned order modal
  const [dispatcherAssignedOrder, setDispatcherAssignedOrder] = useState<any>(null);

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
        new_order: require('../assets/sounds/new_order.mp4'),
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
    // Если таск уже запущен — не перезапускаем! Иначе сбросится lastLocation
    const alreadyRunning = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
    if (alreadyRunning) return;

    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== "granted") {
      Alert.alert("GPS", "Нужен доступ к GPS для работы на линии");
      return;
    }

    await refreshCurrentPosition();
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();

    if (bgStatus !== "granted") {
      Alert.alert("Фоновый GPS", "Разрешите доступ 'Всегда' в настройках для точного подсчёта пути.");
    }

    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 5,   // 5m вместо 15m — точнее на поворотах и в пробках
      timeInterval: 3000,    // max 1 обновление в 3 сек чтобы не спамить
      foregroundService: {
        notificationTitle: "Таксометр работает",
        notificationBody: "Дистанция заказа рассчитывается. Не закрывайте приложение.",
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
    sock.on("connect", () => {
      sock.emit("driver_connect", driverId);
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
      const currentOrder = useDriverStore.getState().activeOrder;
      if (currentOrder && currentOrder.id === data.orderId) {
        setActiveOrder({
          ...currentOrder,
          estimatedPrice: data.estimatedPrice,
          options: data.options,
        });
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
        nextOrder = mapOrderToState(orderRes.data);
        setActiveOrder(nextOrder);
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
  }, [loadDashboard]);

  useEffect(() => {
    if (!activeOrder || activeOrder.status !== "in_progress" || activeOrder.isFixedPrice) {
      return;
    }

    void startTripSync(activeOrder.id).then(() => flushTripPoints(activeOrder.id));
  }, [activeOrder]);

  // ── Map route: build or clear depending on order status ──────────────────
  useEffect(() => {
    if (!mapRef.current) return;

    if (!activeOrder) {
      // No active order — wipe any leftover route
      mapRef.current.clearRoute();
      return;
    }

    const pickup  = parseWktPoint(activeOrder.pickupPoint);
    const dropoff = parseWktPoint(activeOrder.dropoffPoint);

    if (activeOrder.status === "assigned" && pickup && currentCoords) {
      // Driver heading to client → route: my position → pickup
      mapRef.current.buildRoute(currentCoords, pickup, true);
    } else if (activeOrder.status === "arrived") {
      // Driver is on-site — no route needed
      mapRef.current.clearRoute();
    } else if (activeOrder.status === "in_progress" && dropoff && currentCoords) {
      // Trip started → route: my position → dropoff
      routeThrottleRef.current = Date.now();
      mapRef.current.buildRoute(currentCoords, dropoff, true);
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

        // Reconnect socket if it dropped while in background
        const storeState = useDriverStore.getState();
        if (storeState.isOnline && storeState.profile) {
          const sock = getSocket();
          if (!sock || !sock.connected) {
            startSocketAndGPS(storeState.profile.id);
          }
        }

        loadDashboard();
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
      if (bgOfflineTimerRef.current) {
        clearTimeout(bgOfflineTimerRef.current);
      }
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
        // Was going offline but failed — restore socket/GPS
        startSocketAndGPS(profile.id);
      } else {
        stopLocationTracking();
        disconnectSocket();
        realtimeDriverRef.current = null;
      }
      Alert.alert("Ошибка", "Не удалось изменить статус. Проверьте соединение.");
    }
  };

  const acceptOrder = async () => {
    if (!orderAlert) return;

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

  const rejectOrder = () => {
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
      if (serverSessionId) {
        await injectSessionId(order.id, serverSessionId, serverBaseFare, serverCityRate, 0);
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
        // Сначала сбрасываем очередь точек на сервер, чтобы все точки были там
        await flushTripPoints(activeOrder.id);

        // Резервные значения с телефона — сервер использует их только если
        // GPS-сессии нет или точек оказалось меньше 2 (плохой GPS / короткая поездка)
        const storeState = useDriverStore.getState();
        const fallbackDist =
          Math.round(Math.max(storeState.tripDistance, tripDistanceRef.current) * 10) / 10;
        const baseFare = storeState.tripBaseFare || resolveBaseFare(
          activeOrder.class,
          storeState.profile?.vehicle?.classes
        );
        const cityRate = storeState.tripCityRatePerKm || Number(activeOrder.pricePerKm) || 80;
        // Out-of-city time fee at moment of completion
        const outTimeFeeAtCompletion = storeState.isOutOfCity && storeState.outOfCityStartTime
          ? Math.floor((Date.now() - storeState.outOfCityStartTime) / 60000) * 25
          : 0;
        body.clientDistanceKm = fallbackDist;
        body.clientFinalPrice = roundTo5(baseFare + fallbackDist * cityRate) + tripWaitingFee + outTimeFeeAtCompletion;
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
      Alert.alert("Ошибка", res.error);
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
        // Сервер вернул точные данные по GPS
        if (serverDist !== null && serverPrice !== null) {
          Alert.alert(
            "Поездка завершена",
            `Расстояние: ${serverDist.toFixed(1)} км\nИтого: ${serverPrice} ₸`,
          );
        } else {
          // Резервный показ из предварительного счётчика
          const storeState = useDriverStore.getState();
          const fallbackDist = Math.round(Math.max(storeState.tripDistance, tripDistanceRef.current) * 10) / 10;
          const fallbackBaseFare = storeState.tripBaseFare || resolveBaseFare(
            activeOrder.class,
            storeState.profile?.vehicle?.classes
          );
          const fallbackCityRate = storeState.tripCityRatePerKm || Number(activeOrder.pricePerKm) || 80;
          const fallbackPrice = roundTo5(fallbackBaseFare + fallbackDist * fallbackCityRate);
          Alert.alert(
            "Поездка завершена",
            `Расстояние: ${fallbackDist} км\nСумма: ${fallbackPrice} ₸`,
          );
        }
      } else {
        Alert.alert("Заказ отменен", "");
      }

      setActiveOrder(null);
      resetTrip();
      await clearTripSync(activeOrder.id);
      setProfile(profile ? { ...profile, status: "free" } : null);
      loadDashboard();
    } else {
      setActiveOrder({ ...activeOrder, status });
      if (status === "in_progress" && !activeOrder.isFixedPrice) {
        void (async () => {
          await startTripSync(activeOrder.id);

          // Apply server-resolved rates (correct for "Любой" orders with Comfort driver)
          const rates = await getTripRates(activeOrder.id);
          if (rates && rates.effectiveBaseFare) {
            const store = useDriverStore.getState();
            // The server's effectiveBaseFare already includes options (fixed in trip/start).
            // We use it directly as the new tripBaseFare.
            const serverBaseFare = rates.effectiveBaseFare;
            if (serverBaseFare !== store.tripBaseFare) {
              store.setTripBaseFare(serverBaseFare);
              const currentDist = store.tripDistance;
              const cityRate = rates.effectiveCityRatePerKm || 80;
              store.setTripMeter(currentDist, roundTo5(serverBaseFare + currentDist * cityRate));
            }
            store.setTripCityRate(rates.effectiveCityRatePerKm);
          } else if (rates) {
            useDriverStore.getState().setTripCityRate(rates.effectiveCityRatePerKm);
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
    if (!isOutOfCity || !outOfCityStartTime || activeOrder?.status !== "in_progress") {
      setOutOfCityTimeFee(0);
      return;
    }
    const calc = () => {
      const mins = Math.floor((Date.now() - outOfCityStartTime) / 60000);
      setOutOfCityTimeFee(mins * 25);
    };
    calc();
    const interval = setInterval(calc, 15000);
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

      // ── Адресный блок (адрес, телефон, опции, навигатор + кнопка паузы) ───
      const addressBlock = (
        <View style={[styles.addressStrip, { flexDirection: "row", alignItems: "flex-start" }]}>
          {/* Левая часть: весь контент */}
          <View style={{ flex: 1, gap: 10 }}>
            <View style={styles.addressLine}>
              <Ionicons name="location" size={16} color="#FFD000" />
              <Text style={styles.addressLineText} numberOfLines={1}>
                {activeOrder.pickupAddress || "Адрес не указан"}
              </Text>
            </View>
            {activeOrder.isFixedPrice && activeOrder.dropoffAddress && (
              <View style={styles.addressLine}>
                <Ionicons name="flag" size={16} color="#2196F3" />
                <Text style={styles.addressLineText} numberOfLines={1}>
                  {activeOrder.dropoffAddress}
                </Text>
              </View>
            )}
            <TouchableOpacity style={styles.addressLine} onPress={callClient} activeOpacity={0.7}>
              <Ionicons name="call" size={16} color="#FFD000" />
              <Text style={[styles.phoneText, { color: "#FFD000", textDecorationLine: "underline" }]}>
                {activeOrder.phone}
              </Text>
            </TouchableOpacity>

            {activeOrder.status === "arrived" && waitingElapsed > 0 && (
              <View style={styles.addressLine}>
                <Ionicons name="time-outline" size={15} color={waitingElapsed > 180 ? "#ef4444" : "#888"} />
                <Text style={{ fontSize: 13, color: waitingElapsed > 180 ? "#ef4444" : "#aaa", fontWeight: "600" }}>
                  {waitingElapsed > 180
                    ? `Платное: ${Math.floor((waitingElapsed - 180) / 60) * 20} ₸ (${Math.floor(waitingElapsed / 60)} мин)`
                    : `Ожидание: ${Math.floor(waitingElapsed / 60)}:${(waitingElapsed % 60).toString().padStart(2, "0")} (Беспл.)`}
                </Text>
              </View>
            )}

            {Array.isArray(activeOrder.options) && activeOrder.options.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginLeft: 22 }}>
                {activeOrder.options.map((opt: any) => {
                  const key = typeof opt === "string" ? opt : opt.key;
                  const label = opt.label || (key === "luggage" ? "Багаж" : key === "roof_luggage" ? "Верх. Багаж" : key === "conditioner" ? "Кондиционер" : "Опция");
                  const price = opt.price || (key === "luggage" ? 100 : key === "roof_luggage" ? 200 : key === "conditioner" ? 100 : 0);
                  return (
                    <View key={key} style={{ backgroundColor: "#1e293b", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Ionicons name={key === "luggage" ? "briefcase" : key === "roof_luggage" ? "cube" : key === "conditioner" ? "snow" : "apps-outline"} size={12} color={key === "conditioner" ? "#4ade80" : "#fff"} />
                      <Text style={{ fontSize: 10, color: key === "conditioner" ? "#4ade80" : "#fff", fontWeight: "bold" }}>{label} (+{price})</Text>
                    </View>
                  );
                })}
              </View>
            )}

            <TouchableOpacity style={styles.navBtn} onPress={openNavigator} activeOpacity={0.85}>
              <Ionicons name="navigate" size={18} color="#000" />
              <Text style={styles.navBtnText}>
                {activeOrder.status === "assigned" ? "Открыть навигатор → К клиенту" : "Открыть навигатор → К назначению"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Правая часть: кнопка паузы (только во время поездки, не на паузе) */}
          {isInProgress && !isPaused && (
            <TouchableOpacity
              style={styles.pauseBtn}
              onPress={() => toggleTripWaiting("start")}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Ionicons name="pause" size={24} color="#FFD000" />
            </TouchableOpacity>
          )}
        </View>
      );

      // ── Счётчик (км / мин / цена) ──────────────────────────────────────────
      const meterBlock = isInProgress ? (
        <View style={styles.meterStrip}>
          {activeOrder.isFixedPrice ? (
            <>
              <Text style={styles.meterStripLabel}>Фикс. цена</Text>
              <Text style={styles.meterStripPrice}>{displayedTripPrice} ₸</Text>
            </>
          ) : (
            <>
              <View style={styles.meterStripItem}>
                <Ionicons name="speedometer-outline" size={14} color="#888" />
                <Text style={styles.meterStripValue}>{tripDistance.toFixed(1)} км</Text>
              </View>
              <View style={styles.meterStripItem}>
                <Ionicons name="time-outline" size={14} color="#888" />
                <Text style={styles.meterStripValue}>{tripElapsed} мин</Text>
              </View>
              <Text style={styles.meterStripPrice}>{displayedTripPrice}₸</Text>
            </>
          )}
        </View>
      ) : null;

      // ── Кнопка действия ───────────────────────────────────────────────────
      const actionButton = (
        <View style={styles.orderActions}>
          {activeOrder.status === "assigned" && (
            <SwipeButton title="Я на месте" onSwipeComplete={() => updateOrderStatus("arrived")} color="#FFD000" iconName="navigate" disabled={loading} />
          )}
          {activeOrder.status === "arrived" && (
            <SwipeButton title="Клиент сел — поехали" onSwipeComplete={() => updateOrderStatus("in_progress")} color="#FFD000" iconName="car" disabled={loading} />
          )}
          {isInProgress && (
            <SwipeButton title="Завершить поездку" onSwipeComplete={() => updateOrderStatus("completed")} color="#FFD000" iconName="checkmark-circle" disabled={loading} />
          )}
        </View>
      );

      // ── ПАУЗА активна: баннер выходит наверх ──────────────────────────────
      if (isPaused) {
        return (
          <View style={styles.pageBlock}>
            {/* Баннер паузы — вверху экрана */}
            <TouchableOpacity
              style={styles.pauseBanner}
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
                <Text style={styles.pauseResumeBtnText}>Продолжить</Text>
              </View>
            </TouchableOpacity>

            {/* Адрес, телефон, навигатор */}
            {addressBlock}

            {/* Счётчик */}
            {meterBlock}

            {/* Завершить */}
            {actionButton}
          </View>
        );
      }

      // ── Обычный режим (assigned / arrived / in_progress без паузы) ────────
      return (
        <View style={styles.pageBlock}>
          {/* Шапка: номер заказа + GPS + меню */}
          <View style={styles.orderHeader}>
            <Text style={styles.orderHeaderTitle}>Заказ №{activeOrder.id}</Text>

            <TouchableOpacity
              style={[styles.gpsBadge, { marginRight: 8 }]}
              onPress={refreshCurrentPosition}
              disabled={refreshingGPS}
            >
              {refreshingGPS
                ? <ActivityIndicator size={10} color="#fff" style={{ marginRight: 4 }} />
                : <Ionicons name="locate" size={12} color="#fff" />}
              <Text style={[styles.gpsBadgeText, { fontSize: 10 }]}>
                {refreshingGPS ? "Обновление..." : "GPS"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuBtn}
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
              <Ionicons name="ellipsis-vertical" size={20} color="#888" />
            </TouchableOpacity>
          </View>

          {/* Адрес, телефон, навигатор + кнопка паузы */}
          {addressBlock}

          {/* Карта — занимает всё свободное пространство */}
          <View style={styles.mapContainer}>
            <YandexMapView
              ref={mapRef}
              userLocation={currentCoords}
              userHeading={currentHeading}
              pickupLocation={parseWktPoint(activeOrder.pickupPoint)}
              dropoffLocation={parseWktPoint(activeOrder.dropoffPoint)}
              autoFollow={activeOrder.status === "in_progress"}
              zoom={15}
              showCenterButton
            />

            {/* Статус поверх карты */}
            <View style={styles.mapStatusOverlay}>
              <Ionicons
                name={activeOrder.status === "assigned" ? "paper-plane" : activeOrder.status === "arrived" ? "body" : "car-sport"}
                size={14}
                color="#FFD000"
              />
              <Text style={styles.mapStatusText}>
                {activeOrder.status === "assigned"
                  ? "Подача автомобиля..."
                  : activeOrder.status === "arrived"
                    ? "Ожидание клиента"
                    : "В пути..."}
              </Text>
            </View>

            {/* Способ оплаты */}
            <View style={styles.mapPaymentOverlay}>
              <Ionicons name="cash-outline" size={12} color="#22c55e" />
              <Text style={styles.mapPaymentText}>Наличными</Text>
            </View>

            {/* Накопленное ожидание при поездке */}
            {!activeOrder.isWaiting && tripWaitingElapsed > 0 && (
              <View style={styles.mapWaitingOverlay}>
                <Ionicons name="time-outline" size={12} color="#e0c84a" />
                <Text style={styles.mapWaitingText}>
                  +{tripWaitingFee} ₸
                </Text>
              </View>
            )}
          </View>

          {/* Счётчик */}
          {meterBlock}

          {/* Кнопка действия */}
          {actionButton}
        </View>
      );
    }

    return (
      <View style={styles.pageBlock}>
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={[styles.statusDot, isOnline ? styles.dotOnline : styles.dotOffline]} />
            <Text style={styles.headerTitle}>{isOnline ? "Вы на линии" : "Вы вне линии"}</Text>
          </View>
          <TouchableOpacity
            style={styles.gpsBadge}
            onPress={refreshCurrentPosition}
            disabled={refreshingGPS}
            activeOpacity={0.7}
          >
            {refreshingGPS ? (
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: 4 }} />
            ) : (
              <Ionicons name={currentCoords ? "locate" : "locate-outline"} size={14} color="#fff" />
            )}
            <Text style={styles.gpsBadgeText}>
              {refreshingGPS ? "Обновление..." : (currentCoords ? "GPS найден" : "Поиск GPS")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Баланс</Text>
            <Text style={styles.statValue}>{Number(profile.balance).toLocaleString()} ₸</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Рейтинг</Text>
            <Text style={styles.statValue}>#{Number(profile.rating || 0)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Заказов</Text>
            <Text style={styles.statValue}>{Number(profile.ordersCount || 0)}</Text>
          </View>
        </View>

        {/* Карта — занимает всё свободное пространство */}
        <View style={styles.mapContainer}>
          <YandexMapView
            ref={mapRef}
            userLocation={currentCoords}
            userHeading={currentHeading}
            zoom={15}
            showCenterButton
          />

          {/* Статус поверх карты */}
          <View style={styles.mapStatusOverlay}>
            <View style={[styles.statusDot, { width: 8, height: 8, borderRadius: 4 }, isOnline ? styles.dotOnline : styles.dotOffline]} />
            <Text style={styles.mapStatusText}>
              {isOnline ? "Ожидание заказа..." : "Вы вне линии"}
            </Text>
          </View>
        </View>

        {/* Кнопка бордюра — отдельной строкой под картой */}
        {isOnline && profile?.status === "free" && (
          <TouchableOpacity
            style={styles.curbsideButton}
            onPress={handleCurbsideOrder}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Ionicons name="car-sport" size={24} color="#000" />
            <Text style={styles.curbsideButtonText}>Пассажир с бордюра</Text>
          </TouchableOpacity>
        )}

        <View style={styles.homeSwipeContainer}>
          <SwipeButton
            title={togglingOnline ? "Подключение..." : isOnline ? "Уйти с линии" : "Выйти на линию"}
            onSwipeComplete={toggleOnline}
            color={isOnline ? "#cb1111ff" : "#FFD000"}
            textColor={isOnline ? "#fff" : "#000"}
            thumbColor={isOnline ? "#fff" : "#000"}
            iconColor={isOnline ? "#cb1111ff" : "#FFD000"}
            iconName={isOnline ? "power" : "flash"}
            disabled={loading || togglingOnline}
          />
        </View>
      </View>
    );
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case "orders":
        return <ActiveOrdersPanel />;
      case "history":
        return <DriverHistoryPanel />;
      case "chat":
        return <DriverChatPanel />;
      case "profile":
        return <DriverProfilePanel />;
      default:
        return renderHome();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.contentArea}>{renderActiveTab()}</View>

      <View style={[styles.navBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {[
          { key: "home", icon: "home", label: "Главная" },
          { key: "orders", icon: "receipt-outline", label: "Заказы" },
          { key: "history", icon: "list", label: "История" },
          { key: "chat", icon: "chatbubble-ellipses", label: "Чат" },
          { key: "profile", icon: "person", label: "Профиль" },
        ].map((item) => {
          const isActive = activeTab === item.key;
          return (
            <TouchableOpacity key={item.key} style={styles.navItem} onPress={() => setActiveTab(item.key as DriverTab)}>
              <Ionicons name={item.icon as any} size={22} color={isActive ? "#FFD000" : "#555"} />
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

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
              {dispatcherAssignedOrder?.estimatedPrice && (
                <View style={styles.alertRow}>
                  <Ionicons name="cash" size={18} color="#0984e3" />
                  <Text style={[styles.alertText, { fontWeight: "700", fontSize: 16 }]}>
                    {dispatcherAssignedOrder.estimatedPrice} ₸
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
                <Text style={styles.alertBtnText}>Понял</Text>
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
  container: { flex: 1, backgroundColor: "#0a0a0a", paddingTop: 44 },
  contentArea: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0a0a0a" },
  loadingText: { color: "#666", fontSize: 16 },
  pageBlock: { flex: 1, paddingHorizontal: 16, paddingBottom: 90, overflow: "hidden" },

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
  statLabel: { color: "#555", fontSize: 11, marginBottom: 4, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { color: "#fff", fontSize: 18, fontWeight: "800" },

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
  meterStripPrice: { color: "#FFD000", fontSize: 52, fontWeight: "900", letterSpacing: -1 },

  // ─── (Status center replaced by map overlay) ─────────────
  orderActions: { position: "absolute", bottom: Platform.OS === "ios" ? 110 : 22, left: 16, right: 16 },
  curbsideButton: {
    backgroundColor: "#FFD000",
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
    shadowColor: "#FFD000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  curbsideButtonText: {
    color: "#000",
    fontSize: 18,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
});
