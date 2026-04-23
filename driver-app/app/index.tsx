import { useEffect, useCallback, useRef, useState } from "react";
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
import {
  dismissAllOrderNotifications,
  dismissOrderNotification,
  registerForPushNotifications,
  showOrderNotification,
} from "../services/notifications";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DriverHistoryPanel } from "../components/DriverHistoryPanel";
import { DriverChatPanel } from "../components/DriverChatPanel";
import { DriverProfilePanel } from "../components/DriverProfilePanel";
import { ActiveOrdersPanel } from "../components/ActiveOrdersPanel";
import { SwipeButton } from "../components/SwipeButton";
import { mapOrderToActiveOrder } from "../lib/orderPricing";
import { clearTripSync, flushTripPoints, queueTripPoint, startTripSync } from "../services/tripSync";

const BASE_FARE = 290;
const WAITING_RATE_PER_MIN = 20;
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

    // РћР±СЂР°Р±Р°С‚С‹РІР°РµРј Р’РЎР• С‚РѕС‡РєРё РёР· РїР°С‡РєРё, РЅРµ С‚РѕР»СЊРєРѕ РїРµСЂРІСѓСЋ
    for (const loc of locations) {
      const { latitude: lat, longitude: lng } = loc.coords;

      const state = useDriverStore.getState();
      console.log("status:", state.activeOrder?.status);
      console.log("lastLocation:", state.lastLocation);
      console.log("isFixedPrice:", state.activeOrder?.isFixedPrice);

      if (
        state.activeOrder?.status === "in_progress" &&
        !state.activeOrder.isWaiting &&
        state.lastLocation &&
        !state.activeOrder.isFixedPrice
      ) {
        const d = haversine(state.lastLocation.lat, state.lastLocation.lng, lat, lng);

        if (d > 0.015) {
          const newDist = state.tripDistance + d;
          const currentBaseFare = state.activeOrder?.class?.name === "РљРѕРјС„РѕСЂС‚" ? 390 : BASE_FARE;
          const options: any[] = Array.isArray(state.activeOrder?.options) ? state.activeOrder.options : [];
          const extrasTotal = options.reduce((sum, opt) => sum + (Number(opt.price) || 0), 0);
          const newPrice = roundTo5(currentBaseFare + extrasTotal + newDist * Number(state.activeOrder.pricePerKm));
          useDriverStore.getState().setTripMeter(newDist, newPrice);
        }
      }

      // РћР±РЅРѕРІР»СЏРµРј lastLocation РїРѕСЃР»Рµ РєР°Р¶РґРѕР№ С‚РѕС‡РєРё РёР· РїР°С‡РєРё
      useDriverStore.getState().setLastLocation({ lat, lng });

      // РћС‚РїСЂР°РІР»СЏРµРј РїРѕСЃР»РµРґРЅСЋСЋ С‚РѕС‡РєСѓ РЅР° СЃРµСЂРІРµСЂ
      if (
        state.activeOrder?.status === "in_progress" &&
        !state.activeOrder.isWaiting &&
        !state.activeOrder.isFixedPrice
      ) {
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

      api("/api/driver/location", {
        method: "POST",
        body: JSON.stringify({ lat, lng }),
      }).catch(() => { });
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
    activeOrder,
    setActiveOrder,
    tripDistance,
    tripPrice,
    tripStartTime,
    setTripMeter,
    resetTrip,
    startTrip,
  } = useDriverStore();

  const [loading, setLoading] = useState(false);
  const [alertTimer, setAlertTimer] = useState(30);
  const [activeTab, setActiveTab] = useState<DriverTab>("home");
  const [currentCoords, setCurrentCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [refreshingGPS, setRefreshingGPS] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripDistanceRef = useRef(0);
  const activeSoundRef = useRef<Audio.Sound | null>(null);
  const handledOrderAlertsRef = useRef<Map<number, number>>(new Map());
  const insets = useSafeAreaInsets();

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
  }, []);

  useEffect(() => {
    return () => {
      Vibration.cancel();
      void dismissAllOrderNotifications();

      if (activeSoundRef.current) {
        activeSoundRef.current.stopAsync().catch(() => {});
        activeSoundRef.current.unloadAsync().catch(() => {});
        activeSoundRef.current = null;
      }
    };
  }, []);

  const playAppSound = async (type: 'new_order' | 'welcome' | 'trip_completed') => {
    try {
      let source;
      switch (type) {
        case 'new_order':
          source = require('../assets/sounds/new_order.mp4');
          break;
        case 'welcome':
          source = require('../assets/sounds/welcome.mp4');
          break;
        case 'trip_completed':
          source = require('../assets/sounds/trip_completed.mp4');
          break;
      }

      if (activeSoundRef.current) {
        await activeSoundRef.current.stopAsync().catch(() => {});
        await activeSoundRef.current.unloadAsync().catch(() => {});
        activeSoundRef.current = null;
      }

      const { sound } = await Audio.Sound.createAsync(source);
      activeSoundRef.current = sound;
      await sound.playAsync();

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          if (activeSoundRef.current === sound) {
            activeSoundRef.current = null;
          }
          sound.unloadAsync();
        }
      });
    } catch (err) {
      console.warn("Failed to play sound", err);
    }
  };

  const rememberHandledOrderAlert = useCallback((orderId: number) => {
    const now = Date.now();
    const next = new Map(handledOrderAlertsRef.current);

    next.set(orderId, now);
    for (const [knownOrderId, handledAt] of next.entries()) {
      if (now - handledAt > 2 * 60 * 1000) {
        next.delete(knownOrderId);
      }
    }

    handledOrderAlertsRef.current = next;
  }, []);

  const shouldIgnoreOrderAlert = useCallback((orderId: number) => {
    const state = useDriverStore.getState();

    if (state.activeOrder?.id === orderId) return true;
    if (state.orderAlert?.orderId === orderId) return true;

    const handledAt = handledOrderAlertsRef.current.get(orderId);
    return typeof handledAt === "number" && Date.now() - handledAt < 60 * 1000;
  }, []);

  const clearIncomingOrderAlert = useCallback((orderId?: number | null) => {
    Vibration.cancel();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setAlertTimer(30);
    setOrderAlert(null);

    if (typeof orderId === "number") {
      void dismissOrderNotification(orderId);
    } else {
      void dismissAllOrderNotifications();
    }
  }, [setOrderAlert]);

  const lastLocationState = useDriverStore((s) => s.lastLocation);
  useEffect(() => {
    if (lastLocationState) {
      setCurrentCoords({ latitude: lastLocationState.lat, longitude: lastLocationState.lng });
    }
  }, [lastLocationState]);
  const realtimeDriverRef = useRef<number | null>(null);

  const refreshCurrentPosition = useCallback(async () => {
    setRefreshingGPS(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Р“РµРѕР»РѕРєР°С†РёСЏ", "РџСЂРµРґРѕСЃС‚Р°РІСЊС‚Рµ РґРѕСЃС‚СѓРї Рє GPS РІ РЅР°СЃС‚СЂРѕР№РєР°С…");
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

  const startLocationTracking = useCallback(async (driverId: number) => {
    // Р•СЃР»Рё С‚Р°СЃРє СѓР¶Рµ Р·Р°РїСѓС‰РµРЅ вЂ” РЅРµ РїРµСЂРµР·Р°РїСѓСЃРєР°РµРј! РРЅР°С‡Рµ СЃР±СЂРѕСЃРёС‚СЃСЏ lastLocation
    const alreadyRunning = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
    if (alreadyRunning) return;

    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== "granted") {
      Alert.alert("GPS", "РќСѓР¶РµРЅ РґРѕСЃС‚СѓРї Рє GPS РґР»СЏ СЂР°Р±РѕС‚С‹ РЅР° Р»РёРЅРёРё");
      return;
    }

    await refreshCurrentPosition();
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();

    if (bgStatus !== "granted") {
      Alert.alert("Р¤РѕРЅРѕРІС‹Р№ GPS", "Р Р°Р·СЂРµС€РёС‚Рµ РґРѕСЃС‚СѓРї 'Р’СЃРµРіРґР°' РІ РЅР°СЃС‚СЂРѕР№РєР°С… РґР»СЏ С‚РѕС‡РЅРѕРіРѕ РїРѕРґСЃС‡С‘С‚Р° РїСѓС‚Рё.");
    }

    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      distanceInterval: 15,
      timeInterval: 5000,
      foregroundService: {
        notificationTitle: "РўР°РєСЃРѕРјРµС‚СЂ СЂР°Р±РѕС‚Р°РµС‚",
        notificationBody: "Р”РёСЃС‚Р°РЅС†РёСЏ Р·Р°РєР°Р·Р° СЂР°СЃСЃС‡РёС‚С‹РІР°РµС‚СЃСЏ. РќРµ Р·Р°РєСЂС‹РІР°Р№С‚Рµ РїСЂРёР»РѕР¶РµРЅРёРµ.",
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
    clearIncomingOrderAlert();
    await clearToken();
    setProfile(null);
    setOnline(false);
    router.replace("/login");
  }, [clearIncomingOrderAlert, router, setOnline, setProfile, stopLocationTracking]);

  const mapOrderToState = useCallback((order: any) => {
    if (!order) return null;
    const currentBaseFare = order.class?.name === "РљРѕРјС„РѕСЂС‚" ? 390 : BASE_FARE;
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
      if (!data?.orderId || shouldIgnoreOrderAlert(data.orderId)) {
        return;
      }

      if (data.classId) {
        const p = useDriverStore.getState().profile;
        const hasClass = p?.vehicle?.classes?.some((c: any) => c.classId === data.classId);
        if (!hasClass) return;
      }

      rememberHandledOrderAlert(data.orderId);
      Vibration.vibrate([0, 500, 200, 500]);
      playAppSound('new_order');
      showOrderNotification(data.orderId, data.pickupAddress, data.pricePerKm || 80);
      setOrderAlert(data);
      setAlertTimer(30);
    });

    sock.on("order_taken", (data: any) => {
      // Instantly dismiss order modal if taken by another driver
      const currentAlert = useDriverStore.getState().orderAlert;
      if (currentAlert && currentAlert.orderId === data.orderId) {
        clearIncomingOrderAlert(data.orderId);
      }
    });

    // Dispatcher removed this order from us
    sock.on("order_reassigned", (data: any) => {
      const state = useDriverStore.getState();
      if (state.activeOrder?.id === data.orderId) {
        setActiveOrder(null);
        resetTrip();
        Alert.alert("Р”РёСЃРїРµС‚С‡РµСЂ", data.message || "Р—Р°РєР°Р· Р±С‹Р» СЃРЅСЏС‚ СЃ РІР°СЃ");
      }
    });

    // Dispatcher assigned an order directly to us
    sock.on("order_assigned_by_dispatcher", (data: any) => {
      clearIncomingOrderAlert(data?.order?.id);
      Vibration.vibrate([0, 400, 150, 400, 150, 400]);
      playAppSound('new_order');
      const mapped = mapOrderToState(data.order);
      setActiveOrder(mapped);
      setActiveTab("home");
      setDispatcherAssignedOrder(data.order); // Show dedicated modal
    });

    sock.on("order_updated", (data: any) => {
      const state = useDriverStore.getState();
      if (state.activeOrder?.id === data.orderId) {
        const currentOrder = state.activeOrder;
        if (!currentOrder) return;

        setActiveOrder({
          ...currentOrder,
          estimatedPrice: data.estimatedPrice,
          options: data.options,
        });
      }
    });

    sock.on("driver_ratings_updated", () => {
      refreshProfileRank();
    });

    startLocationTracking(driverId);

    if (realtimeDriverRef.current !== driverId) {
      registerForPushNotifications();
    }
    realtimeDriverRef.current = driverId;
  }, [
    clearIncomingOrderAlert,
    refreshProfileRank,
    rememberHandledOrderAlert,
    setOrderAlert,
    shouldIgnoreOrderAlert,
    startLocationTracking,
  ]);

  const loadDashboard = useCallback(async () => {
    const [profileRes, orderRes] = await Promise.all([
      api("/api/driver/profile"),
      api("/api/driver/orders/current"),
    ]);

    if (!profileRes.data) {
      if (!useDriverStore.getState().profile) {
        await logout();
      }
      return;
    }

    const nextProfile = profileRes.data;

    // РРіРЅРѕСЂРёСЂСѓРµРј РѕС€РёР±РєРё СЃРµС‚Рё РїСЂРё РїРѕР»СѓС‡РµРЅРёРё Р·Р°РєР°Р·Р°, С‡С‚РѕР±С‹ РЅРµ СЃР±СЂР°СЃС‹РІР°С‚СЊ СЃС‚РµР№С‚
    let nextOrder = useDriverStore.getState().activeOrder;
    if (!orderRes.error) {
      nextOrder = mapOrderToState(orderRes.data);
      setActiveOrder(nextOrder);
    }

    const shouldStayConnected = nextProfile.status !== "offline" || !!nextOrder;

    setProfile(nextProfile);
    setOnline(shouldStayConnected);

    if (shouldStayConnected) {
      // РќРµ РїРµСЂРµРїРѕРґРєР»СЋС‡Р°РµРј СЃРѕРєРµС‚С‹/GPS РµСЃР»Рё РёРґС‘С‚ Р°РєС‚РёРІРЅР°СЏ РїРѕРµР·РґРєР° вЂ” СЌС‚Рѕ СЃР±СЂРѕСЃРёС‚ lastLocation
      const currentState = useDriverStore.getState();
      const isInTrip = currentState.activeOrder?.status === "in_progress";
      if (!isInTrip) {
        startSocketAndGPS(nextProfile.id);
      }
    } else {
      stopLocationTracking();
      disconnectSocket();
      realtimeDriverRef.current = null;
    }
  }, [logout, mapOrderToState, refreshCurrentPosition, setActiveOrder, setOnline, setProfile, startSocketAndGPS, stopLocationTracking]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!activeOrder || activeOrder.status !== "in_progress" || activeOrder.isFixedPrice) {
      return;
    }

    void startTripSync(activeOrder.id).then(() => flushTripPoints(activeOrder.id));
  }, [activeOrder]);

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
      // вњ… FIX 2: NEVER auto-go-offline. Driver works full day, app can be in background.
      // The driver manually controls their online/offline status.
    });

    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        loadDashboard();
      } else {
        // Keep socket alive in background
        const sock = getSocket();
        const storeState = useDriverStore.getState();
        if (storeState.isOnline && (!sock || !sock.connected) && storeState.profile) {
          connectSocket(storeState.profile.id);
        }
      }
    }, 15000);

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
      timerRef.current = setInterval(() => {
        setAlertTimer((prev) => {
          if (prev <= 1) {
            clearIncomingOrderAlert(orderAlert.orderId);
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
  }, [clearIncomingOrderAlert, orderAlert]);

  const toggleOnline = async () => {
    // вњ… FIX 1: Optimistic update вЂ” instant UI, server sync in background
    const newStatus = isOnline ? "offline" : "free";
    const newIsOnline = !isOnline;

    setOnline(newIsOnline);
    setProfile(profile ? { ...profile, status: newStatus as any } : null);

    if (newIsOnline && profile) {
      startSocketAndGPS(profile.id);
    } else {
      stopLocationTracking();
      disconnectSocket();
      realtimeDriverRef.current = null;
      clearIncomingOrderAlert();
    }

    // Fire-and-forget to server
    api("/api/driver/status", {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus }),
    }).catch(() => {});
  };

  const acceptOrder = async () => {
    if (!orderAlert) return;

    // вњ… FIX 3: Optimistic dismiss вЂ” close modal instantly, don't freeze UI
    const alertSnapshot = orderAlert;
    clearIncomingOrderAlert(alertSnapshot.orderId);
    setLoading(true);

    const res = await api(`/api/driver/orders/${alertSnapshot.orderId}/accept`, {
      method: "POST",
    });
    setLoading(false);

    if (res.error) {
      // Order was already taken вЂ” just silently ignore (modal already closed)
      // If it's a real error, show it but don't reopen modal
      if (!res.error.includes("СѓР¶Рµ РЅР°Р·РЅР°С‡РµРЅ") && !res.error.includes("taken")) {
        Alert.alert("РћС€РёР±РєР°", res.error);
      }
      return;
    }

    setActiveOrder(mapOrderToState(res.data));
    resetTrip();
    setActiveTab("home");
    loadDashboard();
  };

  const rejectOrder = () => {
    clearIncomingOrderAlert(orderAlert?.orderId);
  };

  const handleCurbsideOrder = async () => {
    setLoading(true);
    const res = await api(`/api/driver/orders/curbside`, {
      method: "POST",
    });
    setLoading(false);

    if (res.error) {
      Alert.alert("РћС€РёР±РєР°", res.error);
      return;
    }

    setActiveOrder(mapOrderToState(res.data));
    resetTrip();
    startTrip();
    tripDistanceRef.current = 0;
    useDriverStore.getState().setTripMeter(0, 290); // BASE_FARE
    setTripMeter(0, 290);
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }).then((loc) => {
      useDriverStore.getState().setLastLocation({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
    });

    void (async () => {
      await startTripSync(res.data.id);
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
        await queueTripPoint(res.data.id, seedPoint);
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
    setLoading(false);

    if (res.error) {
      Alert.alert("РћС€РёР±РєР°", res.error);
      return;
    }

    if (res.data) {
      setActiveOrder(mapOrderToState(res.data));
    }
  };

  const updateOrderStatus = async (status: string) => {
    if (!activeOrder) return;

    const body: any = { status };

    if (status === "in_progress") {
      playAppSound('welcome');
      startTrip();

      const currentBaseFare = activeOrder.class?.name === "РљРѕРјС„РѕСЂС‚" ? 390 : BASE_FARE;
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

      // РћР±РЅСѓР»СЏРµРј РѕР±Р° СЃС‡С‘С‚С‡РёРєР° СЃРёРЅС…СЂРѕРЅРЅРѕ
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
        // РЎРЅР°С‡Р°Р»Р° СЃР±СЂР°СЃС‹РІР°РµРј РѕС‡РµСЂРµРґСЊ С‚РѕС‡РµРє РЅР° СЃРµСЂРІРµСЂ, С‡С‚РѕР±С‹ РІСЃРµ С‚РѕС‡РєРё Р±С‹Р»Рё С‚Р°Рј
        await flushTripPoints(activeOrder.id);

        // Р РµР·РµСЂРІРЅС‹Рµ Р·РЅР°С‡РµРЅРёСЏ СЃ С‚РµР»РµС„РѕРЅР° вЂ” СЃРµСЂРІРµСЂ РёСЃРїРѕР»СЊР·СѓРµС‚ РёС… С‚РѕР»СЊРєРѕ РµСЃР»Рё
        // GPS-СЃРµСЃСЃРёРё РЅРµС‚ РёР»Рё С‚РѕС‡РµРє РѕРєР°Р·Р°Р»РѕСЃСЊ РјРµРЅСЊС€Рµ 2 (РїР»РѕС…РѕР№ GPS / РєРѕСЂРѕС‚РєР°СЏ РїРѕРµР·РґРєР°)
        const fallbackDist =
          Math.round(Math.max(useDriverStore.getState().tripDistance, tripDistanceRef.current) * 10) / 10;
        const currentBaseFare = activeOrder.class?.name === "РљРѕРјС„РѕСЂС‚" ? 390 : BASE_FARE;
        body.clientDistanceKm = fallbackDist;
        body.clientFinalPrice = roundTo5(currentBaseFare + fallbackDist * activeOrder.pricePerKm) + tripWaitingFee + 10;
      } else {
        // Fixed-price: СЏРІРЅРѕ РїРµСЂРµРґР°С‘Рј С†РµРЅСѓ
        if (activeOrder.distanceKm > 0) {
          body.distanceKm = activeOrder.distanceKm;
        }
        body.finalPrice = (activeOrder.estimatedPrice ?? activeOrder.currentPrice) + tripWaitingFee;
      }
      // РџРµСЂРµРґР°С‘Рј С‚РµРєСѓС‰РёРµ РєРѕРѕСЂРґРёРЅР°С‚С‹ РґР»СЏ РѕР±СЂР°С‚РЅРѕРіРѕ РіРµРѕРєРѕРґРёСЂРѕРІР°РЅРёСЏ С‚РѕС‡РєРё РІС‹РіСЂСѓР·РєРё
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
      Alert.alert("РћС€РёР±РєР°", res.error);
      return;
    }

    if (status === "completed" || status === "canceled") {
      // РСЃРїРѕР»СЊР·СѓРµРј РґР°РЅРЅС‹Рµ, СЂР°СЃСЃС‡РёС‚Р°РЅРЅС‹Рµ СЃРµСЂРІРµСЂРѕРј Рё РІРѕР·РІСЂР°С‰С‘РЅРЅС‹Рµ РІ РѕС‚РІРµС‚Рµ
      const serverDist = res.data?.distanceKm != null ? Number(res.data.distanceKm) : null;
      const serverPrice = res.data?.finalPrice != null ? Number(res.data.finalPrice) : null;

      if (activeOrder.isFixedPrice) {
        Alert.alert(
          status === "completed" ? "РџРѕРµР·РґРєР° Р·Р°РІРµСЂС€РµРЅР°" : "Р—Р°РєР°Р· РѕС‚РјРµРЅРµРЅ",
          `РС‚РѕРіРѕ: ${serverPrice ?? activeOrder.estimatedPrice} в‚ё`,
        );
      } else if (status === "completed") {
        // РЎРµСЂРІРµСЂ РІРµСЂРЅСѓР» С‚РѕС‡РЅС‹Рµ РґР°РЅРЅС‹Рµ РїРѕ GPS
        if (serverDist !== null && serverPrice !== null) {
          Alert.alert(
            "РџРѕРµР·РґРєР° Р·Р°РІРµСЂС€РµРЅР°",
            `Р Р°СЃСЃС‚РѕСЏРЅРёРµ: ${serverDist.toFixed(1)} РєРј\nРС‚РѕРіРѕ: ${serverPrice} в‚ё`,
          );
        } else {
          // Р РµР·РµСЂРІРЅС‹Р№ РїРѕРєР°Р· РёР· РїСЂРµРґРІР°СЂРёС‚РµР»СЊРЅРѕРіРѕ СЃС‡С‘С‚С‡РёРєР°
          const fallbackDist = Math.round(Math.max(useDriverStore.getState().tripDistance, tripDistanceRef.current) * 10) / 10;
          const currentBaseFare = activeOrder.class?.name === "РљРѕРјС„РѕСЂС‚" ? 390 : BASE_FARE;
          const fallbackPrice = roundTo5(currentBaseFare + fallbackDist * activeOrder.pricePerKm) + 10;
          Alert.alert(
            "РџРѕРµР·РґРєР° Р·Р°РІРµСЂС€РµРЅР°",
            `Р Р°СЃСЃС‚РѕСЏРЅРёРµ: ${fallbackDist} РєРј\nРЎСѓРјРјР°: ${fallbackPrice} в‚ё`,
          );
        }
      } else {
        Alert.alert("Р—Р°РєР°Р· РѕС‚РјРµРЅРµРЅ", "");
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
            // Ignore seed GPS errors вЂ” background tracking will continue.
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
      Alert.alert("РќР°РІРёРіР°С‚РѕСЂ", "РђРґСЂРµСЃ РЅР°Р·РЅР°С‡РµРЅРёСЏ РЅРµ СѓРєР°Р·Р°РЅ");
    }
  };

  const tripElapsed = tripStartTime ? Math.floor((Date.now() - tripStartTime) / 60000) : 0;
  const pickupCoords = parseWktPoint(activeOrder?.pickupPoint);
  const dropoffCoords = parseWktPoint(activeOrder?.dropoffPoint);

  const [arrivedWaitingElapsed, setArrivedWaitingElapsed] = useState(0);
  const [tripWaitingElapsed, setTripWaitingElapsed] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;

    if (activeOrder?.status === "arrived") {
      interval = setInterval(() => {
        if (activeOrder.arrivedAt) {
          const elapsed = Math.floor((Date.now() - new Date(activeOrder.arrivedAt).getTime()) / 1000);
          setArrivedWaitingElapsed(Math.max(0, elapsed));
        } else {
          setArrivedWaitingElapsed((prev) => prev + 1);
        }
      }, 1000);
    } else {
      setArrivedWaitingElapsed(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeOrder?.arrivedAt, activeOrder?.status]);

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

  const tripWaitingFee = Math.floor(tripWaitingElapsed / 60) * WAITING_RATE_PER_MIN;
  const displayedTripPrice = activeOrder?.isFixedPrice
    ? (activeOrder?.estimatedPrice ?? 0) + tripWaitingFee
    : tripPrice + tripWaitingFee;
  const hasTripWaitingSummary =
    activeOrder?.status === "in_progress" &&
    (Boolean(activeOrder?.isWaiting) || tripWaitingElapsed > 0 || Number(activeOrder?.waitingFee) > 0);

  const renderHome = () => {
    if (!profile) {
      return (
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Р—Р°РіСЂСѓР·РєР°...</Text>
        </View>
      );
    }

    if (activeOrder) {
      return (
        <View style={styles.pageBlock}>
          {/* Header: order id + rate + GPS + в‹Ї menu */}
          <View style={styles.orderHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderHeaderTitle}>  Р—Р°РєР°Р· в„–{activeOrder.id}</Text>
            </View>

            <TouchableOpacity
              style={[styles.gpsBadge, { marginRight: 8 }]}
              onPress={refreshCurrentPosition}
              disabled={refreshingGPS}
            >
              {refreshingGPS ? (
                <ActivityIndicator size={10} color="#fff" style={{ marginRight: 4 }} />
              ) : (
                <Ionicons name="locate" size={12} color="#fff" />
              )}
              <Text style={[styles.gpsBadgeText, { fontSize: 10 }]}>
                {refreshingGPS ? "РћР±РЅРѕРІР»РµРЅРёРµ..." : "РћР±РЅРѕРІРёС‚СЊ GPS"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuBtn}
              onPress={() => {
                Alert.alert("Р”РµР№СЃС‚РІРёСЏ", "", [
                  {
                    text: "РћС‚РјРµРЅРёС‚СЊ Р·Р°РєР°Р·",
                    style: "destructive",
                    onPress: () => {
                      Alert.alert("РћС‚РјРµРЅРёС‚СЊ Р·Р°РєР°Р·?", "Р­С‚Рѕ РґРµР№СЃС‚РІРёРµ РЅРµР»СЊР·СЏ РѕС‚РјРµРЅРёС‚СЊ", [
                        { text: "РќРµС‚", style: "cancel" },
                        { text: "Р”Р°, РѕС‚РјРµРЅРёС‚СЊ", style: "destructive", onPress: () => updateOrderStatus("canceled") },
                      ]);
                    },
                  },
                  { text: "Р—Р°РєСЂС‹С‚СЊ", style: "cancel" },
                ]);
              }}
            >
              <Ionicons name="ellipsis-vertical" size={20} color="#888" />
            </TouchableOpacity>
          </View>

          {/* Address + phone strip */}
          <View style={styles.addressStrip}>
            <View style={styles.addressLine}>
              <Ionicons name="location" size={16} color="#FFD000" />
              <Text style={styles.addressLineText} numberOfLines={1}>{activeOrder.pickupAddress || "РђРґСЂРµСЃ РЅРµ СѓРєР°Р·Р°РЅ"}</Text>
            </View>
            {/* Show dropoff only for delivery (fixed price) orders */}
            {activeOrder.isFixedPrice && activeOrder.dropoffAddress && (
              <View style={styles.addressLine}>
                <Ionicons name="flag" size={16} color="#2196F3" />
                <Text style={styles.addressLineText} numberOfLines={1}>{activeOrder.dropoffAddress}</Text>
              </View>
            )}
            <TouchableOpacity style={styles.addressLine} onPress={callClient} activeOpacity={0.7}>
              <Ionicons name="call" size={16} color="#FFD000" />
              <Text style={[styles.phoneText, { color: "#FFD000", textDecorationLine: "underline" }]}>
                {activeOrder.phone}
              </Text>
            </TouchableOpacity>

            {/* Display Options if present */}
            {Array.isArray(activeOrder.options) && activeOrder.options.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4, marginLeft: 22 }}>
                {activeOrder.options.map((opt: any) => {
                  const key = typeof opt === 'string' ? opt : opt.key;
                  const label = opt.label || (key === 'luggage' ? 'Р‘Р°РіР°Р¶' : key === 'roof_luggage' ? 'Р’РµСЂС…. Р‘Р°РіР°Р¶' : key === 'conditioner' ? 'РљРѕРЅРґРёС†РёРѕРЅРµСЂ' : 'РћРїС†РёСЏ');
                  const price = opt.price || (key === 'luggage' ? 100 : key === 'roof_luggage' ? 200 : key === 'conditioner' ? 100 : 0);
                  
                  return (
                    <View key={key} style={{ backgroundColor: "#1e293b", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Ionicons 
                        name={key === 'luggage' ? 'briefcase' : key === 'roof_luggage' ? 'cube' : key === 'conditioner' ? 'snow' : 'apps-outline'} 
                        size={12} 
                        color={key === 'conditioner' ? '#4ade80' : '#fff'} 
                      />
                      <Text style={{ fontSize: 10, color: key === 'conditioner' ? '#4ade80' : '#fff', fontWeight: "bold" }}>
                        {label} (+{price})
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Navigator button вЂ” full width */}
            <TouchableOpacity style={styles.navBtn} onPress={openNavigator} activeOpacity={0.85}>
              <Ionicons name="navigate" size={18} color="#000000ff" />
              <Text style={styles.navBtnText}>
                {
                  activeOrder.status === "assigned"
                    ? "РћС‚РєСЂС‹С‚СЊ РЅР°РІРёРіР°С‚РѕСЂ в†’ Рљ РєР»РёРµРЅС‚Сѓ"
                    : activeOrder.status === "arrived"
                      ? "РћС‚РєСЂС‹С‚СЊ РЅР°РІРёРіР°С‚РѕСЂ в†’ Рљ РЅР°Р·РЅР°С‡РµРЅРёСЋ"
                      : activeOrder.status === "in_progress"
                        ? "РћС‚РєСЂС‹С‚СЊ РЅР°РІРёРіР°С‚РѕСЂ в†’ Рљ РЅР°Р·РЅР°С‡РµРЅРёСЋ"
                        : "РћС‚РєСЂС‹С‚СЊ РЅР°РІРёРіР°С‚РѕСЂ"
                }
              </Text>
            </TouchableOpacity>
          </View>

          {/* Elegant Status Center Fill */}
          <View style={styles.orderStatusCenter}>
            <View style={styles.statusPulseCircle}>
              <Ionicons
                name={activeOrder.status === 'assigned' ? "paper-plane" : activeOrder.status === 'arrived' ? "body" : "car-sport"}
                size={54}
                color="#FFD000"
              />
            </View>
            <Text style={styles.statusCenterText}>
              {activeOrder.status === 'assigned' ? "РџРѕРґР°С‡Р° Р°РІС‚РѕРјРѕР±РёР»СЏ..." :
                activeOrder.status === 'arrived' ? (
                  arrivedWaitingElapsed > 180
                    ? `РџР»Р°С‚РЅРѕРµ РѕР¶РёРґР°РЅРёРµ: ${Math.floor((arrivedWaitingElapsed - 180) / 60) * 20} в‚ё (${Math.floor(arrivedWaitingElapsed / 60)} РјРёРЅ)`
                    : `РћР¶РёРґР°РЅРёРµ: ${Math.floor(arrivedWaitingElapsed / 60)}:${(arrivedWaitingElapsed % 60).toString().padStart(2, '0')} (Р‘РµСЃРїР».)`
                ) :
                  "Р’ РїСѓС‚Рё..."}
            </Text>

            <View style={styles.paymentBadge}>
              <Ionicons name="cash-outline" size={16} color="#22c55e" />
              <Text style={styles.paymentBadgeText}>РћРїР»Р°С‚Р° РЅР°Р»РёС‡РЅС‹РјРё</Text>
            </View>

            {hasTripWaitingSummary && (
              <View style={styles.tripWaitingCard}>
                <View style={styles.tripWaitingHeader}>
                  <Ionicons
                    name={activeOrder.isWaiting ? "pause-circle" : "time-outline"}
                    size={18}
                    color="#FFD000"
                  />
                  <Text style={styles.tripWaitingTitle}>
                    {activeOrder.isWaiting ? "РћР¶РёРґР°РЅРёРµ Р°РєС‚РёРІРЅРѕ" : "РћР¶РёРґР°РЅРёРµ РїРѕ Р·Р°РєР°Р·Сѓ"}
                  </Text>
                </View>
                <Text style={styles.tripWaitingTimer}>
                  {Math.floor(tripWaitingElapsed / 60)}:{(tripWaitingElapsed % 60).toString().padStart(2, "0")}
                </Text>
                <Text style={styles.tripWaitingFee}>+{tripWaitingFee} ₸</Text>
                <Text style={styles.tripWaitingHint}>20 ₸/мин во время паузы поездки</Text>
              </View>
            )}
          </View>

          {/* Meter strip вЂ” single row (preliminary / approximate values) */}
          {activeOrder.status === "in_progress" && (
            <View style={styles.meterStrip}>
              {activeOrder.isFixedPrice ? (
                <>
                  <Text style={styles.meterStripLabel}>Р¤РёРєСЃ. С†РµРЅР°</Text>
                  <Text style={styles.meterStripPrice}>{displayedTripPrice} в‚ё</Text>
                </>
              ) : (
                <>
                  <View style={styles.meterStripItem}>
                    <Ionicons name="speedometer-outline" size={14} color="#888" />
                    {/* '~' indicates preliminary вЂ” server will calculate the exact figure */}
                    <Text style={styles.meterStripValue}>{tripDistance.toFixed(1)} РєРј</Text>
                  </View>
                  <View style={styles.meterStripItem}>
                    <Ionicons name="time-outline" size={14} color="#888" />
                    <Text style={styles.meterStripValue}>{tripElapsed} РјРёРЅ</Text>
                  </View>
                  <Text style={styles.meterStripPrice}>{displayedTripPrice}в‚ё</Text>
                </>
              )}
            </View>
          )}

          {/* Action button */}
          <View style={styles.orderActions}>
            {activeOrder.status === "assigned" && (
              <SwipeButton
                title="РЇ РЅР° РјРµСЃС‚Рµ"
                onSwipeComplete={() => updateOrderStatus("arrived")}
                color="#FFD000"
                iconName="navigate"
                disabled={loading}
              />
            )}
            {activeOrder.status === "arrived" && (
              <SwipeButton
                title="РљР»РёРµРЅС‚ СЃРµР» вЂ” РїРѕРµС…Р°Р»Рё"
                onSwipeComplete={() => updateOrderStatus("in_progress")}
                color="#FFD000"
                iconName="car"
                disabled={loading}
              />
            )}
            {activeOrder.status === "in_progress" && (
              <>
                <TouchableOpacity
                  style={{
                    height: 52,
                    borderRadius: 14,
                    marginBottom: 12,
                    backgroundColor: activeOrder.isWaiting ? "#FFD000" : "#202020",
                    borderWidth: 1,
                    borderColor: activeOrder.isWaiting ? "#FFD000" : "#3a3a3a",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    opacity: loading ? 0.6 : 1,
                  }}
                  onPress={() => toggleTripWaiting(activeOrder.isWaiting ? "stop" : "start")}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={activeOrder.isWaiting ? "play" : "pause"}
                    size={18}
                    color={activeOrder.isWaiting ? "#0a0a0a" : "#fff"}
                  />
                  <Text style={{ color: activeOrder.isWaiting ? "#0a0a0a" : "#fff", fontSize: 14, fontWeight: "800" }}>
                    {activeOrder.isWaiting
                      ? `РџСЂРѕРґРѕР»Р¶РёС‚СЊ РїРѕРµР·РґРєСѓ (${tripWaitingFee} ₸)`
                      : "РќР°С‡Р°С‚СЊ РѕР¶РёРґР°РЅРёРµ · 20 ₸/РјРёРЅ"}
                  </Text>
                </TouchableOpacity>

                <SwipeButton
                  title="Р—Р°РІРµСЂС€РёС‚СЊ РїРѕРµР·РґРєСѓ"
                  onSwipeComplete={() => updateOrderStatus("completed")}
                  color="#ffd000ff"
                  iconName="checkmark-circle"
                  disabled={loading}
                />
              </>
            )}
          </View>
        </View>
      );
    }

    return (
      <View style={styles.pageBlock}>
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={[styles.statusDot, isOnline ? styles.dotOnline : styles.dotOffline]} />
            <Text style={styles.headerTitle}>{isOnline ? "Р’С‹ РЅР° Р»РёРЅРёРё" : "Р’С‹ РІРЅРµ Р»РёРЅРёРё"}</Text>
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
              {refreshingGPS ? "РћР±РЅРѕРІР»РµРЅРёРµ..." : (currentCoords ? "GPS РЅР°Р№РґРµРЅ" : "РџРѕРёСЃРє GPS")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Р‘Р°Р»Р°РЅСЃ</Text>
            <Text style={styles.statValue}>{Number(profile.balance).toLocaleString()} в‚ё</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Р РµР№С‚РёРЅРі</Text>
            <Text style={styles.statValue}>#{Number(profile.rating || 0)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Р—Р°РєР°Р·РѕРІ</Text>
            <Text style={styles.statValue}>{Number(profile.ordersCount || 0)}</Text>
          </View>
        </View>

        <View style={styles.centerArea}>
          {/* GPS status card replacing the map */}
          <View style={styles.gpsStatusCard}>
            <View style={styles.gpsStatusIcon}>
              <Ionicons
                name={currentCoords ? "locate" : "locate-outline"}
                size={48}
                color={currentCoords ? "#FFD000" : "#444"}
              />
            </View>
            <Text style={styles.gpsStatusTitle}>
              {isOnline ? "РћР¶РёРґР°РЅРёРµ Р·Р°РєР°Р·Р°..." : "Р’С‹ РІРЅРµ Р»РёРЅРёРё"}
            </Text>
            {currentCoords ? (
              <Text style={styles.gpsStatusCoords}>
                рџ“Ќ {currentCoords.latitude.toFixed(5)}, {currentCoords.longitude.toFixed(5)}
              </Text>
            ) : (
              <Text style={styles.gpsStatusCoords}>РџРѕРёСЃРє GPS...</Text>
            )}
            <TouchableOpacity
              style={styles.gpsRefreshBtn}
              onPress={refreshCurrentPosition}
              disabled={refreshingGPS}
              activeOpacity={0.7}
            >
              {refreshingGPS ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="refresh" size={16} color="#fff" />
              )}
              <Text style={styles.gpsRefreshBtnText}>
                {refreshingGPS ? "РћР±РЅРѕРІР»РµРЅРёРµ..." : "РћР±РЅРѕРІРёС‚СЊ GPS"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Curbside Button */}
          {isOnline && profile?.status === "free" && (
            <TouchableOpacity
              style={styles.curbsideButton}
              onPress={handleCurbsideOrder}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Ionicons name="car-sport" size={24} color="#000" />
              <Text style={styles.curbsideButtonText}>РџР°СЃСЃР°Р¶РёСЂ СЃ Р±РѕСЂРґСЋСЂР°</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.homeSwipeContainer}>
          <SwipeButton
            title={loading ? "..." : isOnline ? "РЈР№С‚Рё СЃ Р»РёРЅРёРё" : "Р’С‹Р№С‚Рё РЅР° Р»РёРЅРёСЋ"}
            onSwipeComplete={toggleOnline}
            color={isOnline ? "#cb1111ff" : "#FFD000"}
            textColor={isOnline ? "#fff" : "#000"}
            thumbColor={isOnline ? "#fff" : "#000"}
            iconColor={isOnline ? "#cb1111ff" : "#FFD000"}
            iconName={isOnline ? "power" : "flash"}
            disabled={loading}
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
          { key: "home", icon: "home", label: "Р“Р»Р°РІРЅР°СЏ" },
          { key: "orders", icon: "receipt-outline", label: "Р—Р°РєР°Р·С‹" },
          { key: "history", icon: "list", label: "РСЃС‚РѕСЂРёСЏ" },
          { key: "chat", icon: "chatbubble-ellipses", label: "Р§Р°С‚" },
          { key: "profile", icon: "person", label: "РџСЂРѕС„РёР»СЊ" },
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
              <Text style={styles.alertTitle}>РќРћР’Р«Р™ Р—РђРљРђР—!</Text>
            </View>

            <View style={styles.alertBody}>
              <View style={styles.alertRow}>
                <Ionicons name="location" size={18} color="#FFD000" />
                <Text style={styles.alertText}>{orderAlert?.pickupAddress || "РђРґСЂРµСЃ РЅРµ СѓРєР°Р·Р°РЅ"}</Text>
              </View>
              <View style={styles.alertRow}>
                <Ionicons name="call" size={18} color="#FFD000" />
                <Text style={styles.alertText}>{orderAlert?.phone ? `${orderAlert.phone.slice(0, 8)}***` : "вЂ”"}</Text>
              </View>
              <View style={styles.alertRow}>
                <Ionicons name="speedometer" size={18} color="#FFD000" />
                <Text style={styles.alertText}>{orderAlert?.pricePerKm || 80} в‚ё/РєРј</Text>
              </View>
            </View>

            <View style={styles.timerCircle}>
              <Text style={styles.timerText}>{alertTimer}</Text>
            </View>

            <View style={styles.alertActions}>
              <TouchableOpacity style={[styles.alertBtn, { backgroundColor: "#00cb07ff" }]} onPress={acceptOrder} disabled={loading}>
                <Ionicons name="checkmark" size={24} color="#fff" />
                <Text style={styles.alertBtnText}>РџСЂРёРЅСЏС‚СЊ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.alertBtn, { backgroundColor: "#d2291dff" }]} onPress={rejectOrder}>
                <Ionicons name="close" size={24} color="#fff" />
                <Text style={styles.alertBtnText}>РћС‚РєР»РѕРЅРёС‚СЊ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* в”Ђв”Ђ Dispatcher Assignment Modal в”Ђв”Ђ */}
      <Modal visible={!!dispatcherAssignedOrder} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.alertCard, { borderColor: "#0984e3", borderWidth: 2 }]}>
            <View style={styles.alertHeader}>
              <Ionicons name="person" size={28} color="#0984e3" />
              <Text style={[styles.alertTitle, { color: "#0984e3" }]}>Р”РРЎРџР•РўР§Р•Р </Text>
            </View>

            <Text style={{ color: "#ccc", fontSize: 13, textAlign: "center", marginBottom: 14 }}>
              Р’Р°Рј РЅР°Р·РЅР°С‡РёР»Рё Р·Р°РєР°Р· в„–{dispatcherAssignedOrder?.id}
            </Text>

            <View style={styles.alertBody}>
              <View style={styles.alertRow}>
                <Ionicons name="location" size={18} color="#0984e3" />
                <Text style={styles.alertText}>
                  {dispatcherAssignedOrder?.pickupAddress || "РђРґСЂРµСЃ РЅРµ СѓРєР°Р·Р°РЅ"}
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
                    : "вЂ”"}
                </Text>
              </View>
              {dispatcherAssignedOrder?.estimatedPrice && (
                <View style={styles.alertRow}>
                  <Ionicons name="cash" size={18} color="#0984e3" />
                  <Text style={[styles.alertText, { fontWeight: "700", fontSize: 16 }]}>
                    {dispatcherAssignedOrder.estimatedPrice} в‚ё
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
                <Text style={styles.alertBtnText}>РџРѕРЅСЏР»</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // в”Ђв”Ђв”Ђ Layout в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  container: { flex: 1, backgroundColor: "#0a0a0a", paddingTop: 44 },
  contentArea: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0a0a0a" },
  loadingText: { color: "#666", fontSize: 16 },
  pageBlock: { flex: 1, paddingHorizontal: 16, paddingBottom: 90 },

  // в”Ђв”Ђв”Ђ Header (waiting) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingTop: 4 },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: 0.3 },
  headerRate: { color: "#FFD000", fontSize: 17, fontWeight: "700" },

  // в”Ђв”Ђв”Ђ GPS badge (top right in waiting) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  gpsBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1c1c1c", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#2a2a2a" },
  gpsBadgeText: { color: "#aaa", fontSize: 12, fontWeight: "600" },

  // в”Ђв”Ђв”Ђ Online dot в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotOnline: { backgroundColor: "#22c55e", shadowColor: "#22c55e", shadowOpacity: 0.8, shadowRadius: 4, elevation: 4 },
  dotOffline: { backgroundColor: "#ef4444" },

  // в”Ђв”Ђв”Ђ Stats row в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: "#161616", borderRadius: 14, padding: 12, alignItems: "center", borderWidth: 1, borderColor: "#222" },
  statLabel: { color: "#555", fontSize: 11, marginBottom: 4, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { color: "#fff", fontSize: 18, fontWeight: "800" },

  // в”Ђв”Ђв”Ђ GPS status card (center area) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  centerArea: { flex: 1, marginBottom: 14 },
  gpsStatusCard: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111",
    borderRadius: 24,
    gap: 14,
    borderWidth: 1,
    borderColor: "#1e1e1e",
  },
  gpsStatusIcon: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "#161616",
    justifyContent: "center", alignItems: "center",
    borderWidth: 2, borderColor: "#2a2a2a",
  },
  gpsStatusTitle: { color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: 0.3 },
  gpsStatusCoords: { color: "#444", fontSize: 11, fontFamily: "monospace" },
  gpsRefreshBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#1c1c1c",
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24,
    borderWidth: 1, borderColor: "#2a2a2a", marginTop: 4,
  },
  gpsRefreshBtnText: { color: "#aaa", fontSize: 13, fontWeight: "600" },

  // в”Ђв”Ђв”Ђ Order header в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  orderHeader: { flexDirection: "row", alignItems: "center", gap: 0, marginBottom: 10, paddingTop: 3 },
  orderHeaderTitle: { color: "#fff", fontSize: 17, flex: 1, paddingTop: 10, fontWeight: "800" },
  menuBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#161616", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#222" },

  // в”Ђв”Ђв”Ђ Address strip в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  addressStrip: { backgroundColor: "#111", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, gap: 10, borderWidth: 1, borderColor: "#1e1e1e" },
  addressLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  addressLineText: { color: "#e0e0e0", fontSize: 19, flex: 1, lineHeight: 25, marginTop: 4, fontWeight: "700" },
  phoneText: { color: "#e0e0e0", fontSize: 19, flex: 1, marginTop: 4, fontWeight: "700" },

  // в”Ђв”Ђв”Ђ Navigator button в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  navBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#FFD000", borderRadius: 30,
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 10,
  },
  navBtnText: { color: "#000", fontSize: 15, fontWeight: "800", flex: 1, textAlign: "center" },

  // в”Ђв”Ђв”Ђ BIG Meter strip в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

  // в”Ђв”Ђв”Ђ Status Center Overlay в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  orderStatusCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 15,
  },
  statusPulseCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255, 208, 0, 0.05)",
    borderWidth: 2,
    borderColor: "rgba(255, 208, 0, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  statusCenterText: {
    color: "#eed535ff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  paymentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  paymentBadgeText: {
    color: "#22c55e",
    fontSize: 13,
    fontWeight: "700",
  },
  tripWaitingCard: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255, 208, 0, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 208, 0, 0.22)",
    alignItems: "center",
    minWidth: 220,
  },
  tripWaitingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  tripWaitingTitle: {
    color: "#f2e3a2",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  tripWaitingTimer: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 1,
  },
  tripWaitingFee: {
    color: "#FFD000",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 2,
  },
  tripWaitingHint: {
    color: "#b4a77a",
    fontSize: 12,
    marginTop: 6,
  },

  orderActions: { position: "absolute", bottom: Platform.OS === "ios" ? 110 : 22, left: 16, right: 16 },
  curbsideButton: {
    backgroundColor: "#FFD000",
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginTop: 20,
    marginHorizontal: 16,
    shadowColor: "#FFD000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
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

  // в”Ђв”Ђв”Ђ Legacy (for compatibility) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

  // в”Ђв”Ђв”Ђ Map containers (kept for safety) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  mapContainerWaiting: { flex: 1, borderRadius: 20, overflow: "hidden" },
  mapContainerOrder: { flex: 1, borderRadius: 16, overflow: "hidden", marginBottom: 8 },
  map: { width: "100%", height: "100%" },
  waitingOverlay: { position: "absolute", top: 12, left: 12, backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  waitingText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // в”Ђв”Ђв”Ђ Bottom nav bar в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
  navBar: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: "#505050ff", paddingVertical: 10, paddingHorizontal: 10, backgroundColor: "#0a0a0a" },
  navItem: { alignItems: "center", gap: 3 },
  navLabel: { color: "#888888ff", fontSize: 10, fontWeight: "600" },
  navLabelActive: { color: "#FFD000" },

  // в”Ђв”Ђв”Ђ New order alert modal в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
});


