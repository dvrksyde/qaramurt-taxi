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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, clearToken } from "../services/api";
import { connectSocket, disconnectSocket, getSocket } from "../services/socket";
import { useDriverStore } from "../stores/driverStore";
import * as Location from "expo-location";
import { registerForPushNotifications, showOrderNotification } from "../services/notifications";
import { DriverHistoryPanel } from "../components/DriverHistoryPanel";
import { DriverChatPanel } from "../components/DriverChatPanel";
import { DriverProfilePanel } from "../components/DriverProfilePanel";
import { ActiveOrdersPanel } from "../components/ActiveOrdersPanel";
import { YandexMapView } from "../components/YandexMapView";
import { SwipeButton } from "../components/SwipeButton";

const BASE_FARE = 290;
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const lastLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const tripDistanceRef = useRef(0);
  const realtimeDriverRef = useRef<number | null>(null);

  const refreshCurrentPosition = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;

    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    const nextCoords = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    };
    setCurrentCoords(nextCoords);
    lastLocationRef.current = { lat: nextCoords.latitude, lng: nextCoords.longitude };
  }, []);

  const startLocationTracking = useCallback(async (driverId: number) => {
    if (locationSubRef.current) return;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("GPS", "Нужен доступ к GPS для работы на линии");
      return;
    }

    await refreshCurrentPosition();
    await Location.requestBackgroundPermissionsAsync();

    locationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        distanceInterval: 10,
        timeInterval: 2000,
      },
      (loc) => {
        const { latitude: lat, longitude: lng } = loc.coords;
        const state = useDriverStore.getState();

        // Only recalculate price for non-fixed-price orders (taxi, not delivery)
        if (state.activeOrder?.status === "in_progress" && lastLocationRef.current && !state.activeOrder.isFixedPrice) {
          const d = haversine(lastLocationRef.current.lat, lastLocationRef.current.lng, lat, lng);
          // Ignore GPS drift — only count movement > 20 meters
          if (d > 0.02) {
            tripDistanceRef.current += d;
            const price = roundTo5(BASE_FARE + tripDistanceRef.current * Number(state.activeOrder.pricePerKm));
            setTripMeter(tripDistanceRef.current, price);
          }
        }

        lastLocationRef.current = { lat, lng };
        setCurrentCoords({ latitude: lat, longitude: lng });

        api("/api/driver/location", {
          method: "POST",
          body: JSON.stringify({ lat, lng }),
        });
      },
    );
  }, [refreshCurrentPosition, setTripMeter]);

  const stopLocationTracking = useCallback(() => {
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
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
    const estimated = Number(order.estimatedPrice) || 0;
    const hasFixedPrice = estimated > 0;
    return {
      ...order,
      distanceKm: Number(order.distanceKm) || 0,
      currentPrice: hasFixedPrice ? estimated : (Number(order.finalPrice) || BASE_FARE),
      estimatedPrice: hasFixedPrice ? estimated : null,
      isFixedPrice: hasFixedPrice,
      pricePerKm: Number(order.pricePerKm) || 80,
    };
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

    sock.on("new_order_alert", (data: any) => {
      Vibration.vibrate([0, 500, 200, 500]);
      showOrderNotification(data.pickupAddress, data.pricePerKm || 80);
      setOrderAlert(data);
      setAlertTimer(30);
    });

    sock.on("order_taken", (data: any) => {
      const currentAlert = useDriverStore.getState().orderAlert;
      if (currentAlert && currentAlert.orderId === data.orderId) {
        setOrderAlert(null);
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
  }, [refreshProfileRank, setOrderAlert, startLocationTracking]);

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
    const nextOrder = mapOrderToState(orderRes.data);
    const shouldStayConnected = nextProfile.status !== "offline" || !!nextOrder;

    setProfile(nextProfile);
    setActiveOrder(nextOrder);
    setOnline(shouldStayConnected);

    await refreshCurrentPosition();

    if (shouldStayConnected) {
      startSocketAndGPS(nextProfile.id);
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
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        loadDashboard();
      }
    });

    const interval = setInterval(() => {
      loadDashboard();
    }, 15000);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (orderAlert) {
      timerRef.current = setInterval(() => {
        setAlertTimer((prev) => {
          if (prev <= 1) {
            setOrderAlert(null);
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
  }, [orderAlert, setOrderAlert]);

  const toggleOnline = async () => {
    setLoading(true);
    const newStatus = isOnline ? "offline" : "free";
    const res = await api("/api/driver/status", {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus }),
    });
    setLoading(false);

    if (res.error) {
      Alert.alert("Ошибка", res.error);
      return;
    }

    setOnline(!isOnline);
    if (newStatus === "free" && profile) {
      startSocketAndGPS(profile.id);
    } else {
      stopLocationTracking();
      disconnectSocket();
      realtimeDriverRef.current = null;
    }

    setProfile(profile ? { ...profile, status: newStatus as any } : null);
  };

  const acceptOrder = async () => {
    if (!orderAlert) return;
    setLoading(true);
    const res = await api(`/api/driver/orders/${orderAlert.orderId}/accept`, {
      method: "POST",
    });
    setLoading(false);

    if (res.error) {
      Alert.alert("Ошибка", res.error);
      setOrderAlert(null);
      return;
    }

    setActiveOrder(mapOrderToState(res.data));
    setOrderAlert(null);
    resetTrip();
    setActiveTab("home");
    loadDashboard();
  };

  const rejectOrder = () => {
    setOrderAlert(null);
  };

  const updateOrderStatus = async (status: string) => {
    if (!activeOrder) return;

    const body: any = { status };

    if (status === "in_progress") {
      startTrip();
      tripDistanceRef.current = 0;
    }

    if (status === "completed") {
      const finalDist = Math.round(tripDistanceRef.current * 10) / 10;
      // For fixed-price (delivery) orders, use the pre-calculated estimated price
      const finalPrice = activeOrder.isFixedPrice
        ? activeOrder.estimatedPrice!
        : roundTo5(BASE_FARE + finalDist * activeOrder.pricePerKm);
      body.distanceKm = finalDist;
      body.finalPrice = finalPrice;
      if (lastLocationRef.current) {
        body.lat = lastLocationRef.current.lat;
        body.lng = lastLocationRef.current.lng;
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
      const finalDist = Math.round(tripDistanceRef.current * 10) / 10;
      const finalPrice = activeOrder.isFixedPrice
        ? activeOrder.estimatedPrice!
        : roundTo5(BASE_FARE + finalDist * activeOrder.pricePerKm);
      Alert.alert(
        status === "completed" ? "Поездка завершена" : "Заказ отменен",
        activeOrder.isFixedPrice
          ? `Итого: ${finalPrice} ₸`
          : `Расстояние: ${finalDist} км\nИтого: ${finalPrice} ₸`,
      );
      setActiveOrder(null);
      resetTrip();
      setProfile(profile ? { ...profile, status: "free" } : null);
      loadDashboard();
    } else {
      setActiveOrder({ ...activeOrder, status });
    }
  };

  const callClient = () => {
    if (activeOrder?.phone) {
      Linking.openURL(`tel:${activeOrder.phone}`);
    }
  };

  const tripElapsed = tripStartTime ? Math.floor((Date.now() - tripStartTime) / 60000) : 0;
  const pickupCoords = parseWktPoint(activeOrder?.pickupPoint);
  const dropoffCoords = parseWktPoint(activeOrder?.dropoffPoint);

  const renderHome = () => {
    if (!profile) {
      return (
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Загрузка...</Text>
        </View>
      );
    }

    if (activeOrder) {
      return (
        <View style={styles.pageBlock}>
          {/* Header: order id + rate + ⋯ menu */}
          <View style={styles.orderHeader}>
            <Text style={styles.orderHeaderTitle}>Заказ #{activeOrder.id}</Text>
            <Text style={styles.headerRate}>{activeOrder.pricePerKm} ₸/км</Text>
            <TouchableOpacity
              style={styles.menuBtn}
              onPress={() => {
                Alert.alert("Действия", "", [
                  {
                    text: "Отменить заказ",
                    style: "destructive",
                    onPress: () => {
                      Alert.alert("Отменить заказ?", "Это действие нельзя отменить", [
                        { text: "Нет", style: "cancel" },
                        { text: "Да, отменить", style: "destructive", onPress: () => updateOrderStatus("canceled") },
                      ]);
                    },
                  },
                  { text: "Закрыть", style: "cancel" },
                ]);
              }}
            >
              <Ionicons name="ellipsis-vertical" size={20} color="#888" />
            </TouchableOpacity>
          </View>

          {/* Address + phone strip */}
          <View style={styles.addressStrip}>
            <View style={styles.addressLine}>
              <Ionicons name="location" size={16} color="#4CAF50" />
              <Text style={styles.addressLineText} numberOfLines={1}>{activeOrder.pickupAddress || "Адрес не указан"}</Text>
            </View>
            {/* Show dropoff only for delivery (fixed price) orders */}
            {activeOrder.isFixedPrice && activeOrder.dropoffAddress && (
              <View style={styles.addressLine}>
                <Ionicons name="flag" size={16} color="#2196F3" />
                <Text style={styles.addressLineText} numberOfLines={1}>{activeOrder.dropoffAddress}</Text>
              </View>
            )}
            <View style={styles.addressLine}>
              <Ionicons name="call" size={16} color="#25D366" />
              <Text style={styles.phoneText}>{activeOrder.phone}</Text>
              <TouchableOpacity style={styles.callBtnCompact} onPress={callClient}>
                <Text style={styles.callBtnCompactText}>Позвонить</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Map takes all available space */}
          <View style={styles.mapContainerOrder}>
            <YandexMapView
              center={pickupCoords}
              userLocation={currentCoords}
              pickupLocation={pickupCoords}
              dropoffLocation={dropoffCoords}
              zoom={15}
            />
          </View>

          {/* Meter strip — single row */}
          {activeOrder.status === "in_progress" && (
            <View style={styles.meterStrip}>
              {activeOrder.isFixedPrice ? (
                <>
                  <Text style={styles.meterStripLabel}>Фикс. цена</Text>
                  <Text style={styles.meterStripPrice}>{activeOrder.estimatedPrice} ₸</Text>
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
                  <Text style={styles.meterStripPrice}>{tripPrice} ₸</Text>
                </>
              )}
            </View>
          )}

          {/* Action button */}
          <View style={styles.orderActions}>
            {activeOrder.status === "assigned" && (
              <SwipeButton
                title="Я на месте"
                onSwipeComplete={() => updateOrderStatus("arrived")}
                color="#2196F3"
                iconName="navigate"
                disabled={loading}
              />
            )}
            {activeOrder.status === "arrived" && (
              <SwipeButton
                title="Клиент сел — поехали"
                onSwipeComplete={() => updateOrderStatus("in_progress")}
                color="#4CAF50"
                iconName="car"
                disabled={loading}
              />
            )}
            {activeOrder.status === "in_progress" && (
              <SwipeButton
                title="Завершить поездку"
                onSwipeComplete={() => updateOrderStatus("completed")}
                color="#c8440a"
                iconName="checkmark-circle"
                disabled={loading}
              />
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
            <Text style={styles.headerTitle}>{isOnline ? "На линии" : "Вне линии"}</Text>
          </View>
          <View style={styles.gpsBadge}>
            <Ionicons name={currentCoords ? "locate" : "locate-outline"} size={14} color="#fff" />
            <Text style={styles.gpsBadgeText}>{currentCoords ? "GPS найден" : "Поиск GPS"}</Text>
          </View>
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

        <View style={styles.centerArea}>
          <View style={styles.mapContainerWaiting}>
            <YandexMapView
              center={currentCoords}
              userLocation={currentCoords}
              zoom={15}
            />
            <View style={styles.waitingOverlay}>
              <Ionicons name="radio-outline" size={20} color="#fff" />
              <Text style={styles.waitingText}>{isOnline ? "Ожидание заказа..." : "Текущее местоположение"}</Text>
            </View>
          </View>
        </View>

        <SwipeButton
          title={loading ? "..." : isOnline ? "Уйти с линии" : "Выйти на линию"}
          onSwipeComplete={toggleOnline}
          color={isOnline ? "#f44336" : "#4CAF50"}
          iconName={isOnline ? "power" : "flash"}
          disabled={loading}
        />
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

      <View style={styles.navBar}>
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
              <Ionicons name={item.icon as any} size={22} color={isActive ? "#c8440a" : "#888"} />
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Modal visible={!!orderAlert} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.alertCard}>
            <View style={styles.alertHeader}>
              <Ionicons name="notifications" size={24} color="#c8440a" />
              <Text style={styles.alertTitle}>НОВЫЙ ЗАКАЗ!</Text>
            </View>

            <View style={styles.alertBody}>
              <View style={styles.alertRow}>
                <Ionicons name="location" size={18} color="#c8440a" />
                <Text style={styles.alertText}>{orderAlert?.pickupAddress || "Адрес не указан"}</Text>
              </View>
              <View style={styles.alertRow}>
                <Ionicons name="call" size={18} color="#25D366" />
                <Text style={styles.alertText}>{orderAlert?.phone ? `${orderAlert.phone.slice(0, 8)}***` : "—"}</Text>
              </View>
              <View style={styles.alertRow}>
                <Ionicons name="speedometer" size={18} color="#2196F3" />
                <Text style={styles.alertText}>{orderAlert?.pricePerKm || 80} ₸/км</Text>
              </View>
            </View>

            <View style={styles.timerCircle}>
              <Text style={styles.timerText}>{alertTimer}</Text>
            </View>

            <View style={styles.alertActions}>
              <TouchableOpacity style={[styles.alertBtn, { backgroundColor: "#4CAF50" }]} onPress={acceptOrder} disabled={loading}>
                <Ionicons name="checkmark" size={24} color="#fff" />
                <Text style={styles.alertBtnText}>Принять</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.alertBtn, { backgroundColor: "#f44336" }]} onPress={rejectOrder}>
                <Ionicons name="close" size={24} color="#fff" />
                <Text style={styles.alertBtnText}>Отклонить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", paddingTop: 44 },
  contentArea: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#888", fontSize: 16 },
  pageBlock: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  headerRate: { color: "#c8440a", fontSize: 14, fontWeight: "600" },
  gpsBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#2b3b63", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  gpsBadgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  dotOnline: { backgroundColor: "#4CAF50" },
  dotOffline: { backgroundColor: "#f44336" },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  statCard: { flex: 1, backgroundColor: "#252540", borderRadius: 10, padding: 8, alignItems: "center" },
  statLabel: { color: "#888", fontSize: 11, marginBottom: 4 },
  statValue: { color: "#fff", fontSize: 16, fontWeight: "700" },
  centerArea: { flex: 1, marginBottom: 10 },
  mapContainerWaiting: { flex: 1, borderRadius: 16, overflow: "hidden" },
  mapContainerOrder: { flex: 1, borderRadius: 12, overflow: "hidden", marginBottom: 8 },
  map: { width: "100%", height: "100%" },
  waitingOverlay: { position: "absolute", top: 12, left: 12, backgroundColor: "rgba(26,26,46,0.84)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  waitingText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  // Order header
  orderHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  orderHeaderTitle: { color: "#fff", fontSize: 17, fontWeight: "700", flex: 1 },
  menuBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#252540", justifyContent: "center", alignItems: "center" },
  // Address + phone strip
  addressStrip: { backgroundColor: "#252540", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8, gap: 8 },
  addressLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  addressLineText: { color: "#fff", fontSize: 14, flex: 1 },
  phoneText: { color: "#fff", fontSize: 14, flex: 1 },
  callBtnCompact: { backgroundColor: "#25D366", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  callBtnCompactText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  // Meter strip — single row
  meterStrip: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#252540", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8, gap: 16, borderWidth: 1, borderColor: "#c8440a" },
  meterStripItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  meterStripLabel: { color: "#888", fontSize: 13 },
  meterStripValue: { color: "#fff", fontSize: 15, fontWeight: "700" },
  meterStripPrice: { color: "#c8440a", fontSize: 28, fontWeight: "800" },
  // Legacy styles kept for compatibility
  card: { backgroundColor: "#252540", borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { color: "#fff", fontSize: 15, flex: 1 },
  callBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#25D366", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  callBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  meterCard: { backgroundColor: "#252540", borderRadius: 16, padding: 20, marginBottom: 16, alignItems: "center", borderWidth: 1, borderColor: "#c8440a" },
  meterRow: { flexDirection: "row", gap: 24, marginBottom: 16 },
  meterItem: { alignItems: "center" },
  meterLabel: { color: "#888", fontSize: 12, marginBottom: 4 },
  meterValue: { color: "#fff", fontSize: 20, fontWeight: "700" },
  priceLabel: { color: "#888", fontSize: 12, marginBottom: 4 },
  priceValue: { color: "#c8440a", fontSize: 42, fontWeight: "800" },
  orderActions: { marginBottom: 4 },
  statusActions: { gap: 12, marginBottom: 16 },
  statusHint: { color: "#888", fontSize: 13, textAlign: "center", marginBottom: 4 },
  // SOS & Cancel — compact inline chips
  orderBottomBar: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingVertical: 6,
  },
  sosChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(244,67,54,0.12)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(244,67,54,0.3)",
  },
  sosChipText: {
    color: "#f44336",
    fontSize: 12,
    fontWeight: "700",
  },
  cancelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(136,136,136,0.1)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(136,136,136,0.2)",
  },
  cancelChipText: {
    color: "#888",
    fontSize: 12,
    fontWeight: "600",
  },
  navBar: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: "#252540", paddingVertical: 10, paddingHorizontal: 10, backgroundColor: "#1a1a2e" },
  navItem: { alignItems: "center", gap: 2 },
  navLabel: { color: "#888", fontSize: 10, fontWeight: "600" },
  navLabelActive: { color: "#c8440a" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", paddingHorizontal: 24 },
  alertCard: { backgroundColor: "#252540", borderRadius: 20, padding: 24, borderWidth: 2, borderColor: "#c8440a" },
  alertHeader: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 20 },
  alertTitle: { color: "#c8440a", fontSize: 22, fontWeight: "800" },
  alertBody: { gap: 12, marginBottom: 20 },
  alertRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  alertText: { color: "#fff", fontSize: 15, flex: 1 },
  timerCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: "#c8440a", justifyContent: "center", alignItems: "center", alignSelf: "center", marginBottom: 20 },
  timerText: { color: "#c8440a", fontSize: 24, fontWeight: "800" },
  alertActions: { flexDirection: "row", gap: 12 },
  alertBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 12 },
  alertBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
