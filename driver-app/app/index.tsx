import { useEffect, useCallback, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  Modal, Linking, Vibration, AppState, Dimensions
} from "react-native";
import MapView, { UrlTile, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, clearToken } from "../services/api";
import { connectSocket, disconnectSocket, getSocket } from "../services/socket";
import { useDriverStore } from "../stores/driverStore";
import * as Location from "expo-location";
import { registerForPushNotifications, showOrderNotification } from "../services/notifications";

const BASE_FARE = 290; // Starting price

function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

export default function MainScreen() {
  const router = useRouter();
  const {
    profile, setProfile,
    isOnline, setOnline,
    orderAlert, setOrderAlert,
    activeOrder, setActiveOrder,
    tripDistance, tripPrice, tripStartTime,
    setTripMeter, resetTrip, startTrip,
  } = useDriverStore();

  const [loading, setLoading] = useState(false);
  const [alertTimer, setAlertTimer] = useState(30);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const lastLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const tripDistanceRef = useRef(0);

  // Load profile on mount
  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    const res = await api("/api/driver/profile");
    if (res.error) {
      // Token invalid — logout
      await clearToken();
      router.replace("/login");
      return;
    }
    setProfile(res.data);
    if (res.data.status === "free") {
      setOnline(true);
      startSocketAndGPS(res.data.id);
    }
    // Check for active order
    const orderRes = await api("/api/driver/orders/current");
    if (orderRes.data) {
      setActiveOrder({
        ...orderRes.data,
        distanceKm: Number(orderRes.data.distanceKm) || 0,
        currentPrice: Number(orderRes.data.finalPrice) || BASE_FARE,
        pricePerKm: Number(orderRes.data.pricePerKm) || 80,
      });
    }
  };

  // Socket events
  const startSocketAndGPS = useCallback((driverId: number) => {
    const sock = connectSocket(driverId);

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

    // Start GPS tracking
    startLocationTracking(driverId);

    // Register push notifications
    registerForPushNotifications();
  }, []);

  const startLocationTracking = async (driverId: number) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("GPS", "Нужен доступ к GPS для работы на линии");
      return;
    }

    // Background permission
    const bgStatus = await Location.requestBackgroundPermissionsAsync();

    locationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 20, // every 20 meters
        timeInterval: 3000,   // or every 3 seconds
      },
      (loc) => {
        const { latitude: lat, longitude: lng } = loc.coords;

        // Calculate trip distance if in_progress
        const state = useDriverStore.getState();
        if (state.activeOrder?.status === "in_progress" && lastLocationRef.current) {
          const d = haversine(lastLocationRef.current.lat, lastLocationRef.current.lng, lat, lng);
          tripDistanceRef.current += d;
          const price = roundTo5(BASE_FARE + tripDistanceRef.current * Number(state.activeOrder.pricePerKm));
          setTripMeter(tripDistanceRef.current, price);
        }

        lastLocationRef.current = { lat, lng };

        // Send to server
        api("/api/driver/location", {
          method: "POST",
          body: JSON.stringify({ lat, lng }),
        });
      }
    );
  };

  const stopLocationTracking = () => {
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
  };

  // Order alert countdown
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
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [orderAlert]);

  // Toggle online/offline
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
    }

    setProfile(profile ? { ...profile, status: newStatus as any } : null);
  };

  // Accept order
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

    setActiveOrder({
      ...res.data,
      distanceKm: 0,
      currentPrice: BASE_FARE,
      pricePerKm: Number(res.data.pricePerKm) || 80,
    });
    setOrderAlert(null);
    resetTrip();
  };

  // Reject order
  const rejectOrder = () => {
    setOrderAlert(null);
  };

  // Update order status
  const updateOrderStatus = async (status: string) => {
    if (!activeOrder) return;

    const body: any = { status };

    if (status === "in_progress") {
      // Start the meter
      startTrip();
      tripDistanceRef.current = 0;
    }

    if (status === "completed") {
      // Save final data
      const finalDist = Math.round(tripDistanceRef.current * 10) / 10;
      const finalPrice = roundTo5(BASE_FARE + finalDist * activeOrder.pricePerKm);
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
      const finalPrice = roundTo5(BASE_FARE + finalDist * activeOrder.pricePerKm);
      Alert.alert(
        "✅ Поездка завершена",
        `Расстояние: ${finalDist} км\nИтого: ${finalPrice} ₸`,
      );
      setActiveOrder(null);
      resetTrip();
      setProfile(profile ? { ...profile, status: "free" } : null);
      loadProfile(); // Refresh stats
    } else {
      setActiveOrder({ ...activeOrder, status });
    }
  };

  // Call client
  const callClient = () => {
    if (activeOrder?.phone) {
      Linking.openURL(`tel:${activeOrder.phone}`);
    }
  };

  // Logout
  const logout = async () => {
    stopLocationTracking();
    disconnectSocket();
    await clearToken();
    setProfile(null);
    setOnline(false);
    router.replace("/login");
  };

  // Elapsed time since trip started
  const tripElapsed = tripStartTime
    ? Math.floor((Date.now() - tripStartTime) / 60000)
    : 0;

  if (!profile) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Загрузка...</Text>
      </View>
    );
  }

  // ─── ACTIVE ORDER SCREEN ──────────────────────────────────
  if (activeOrder) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Заказ #{activeOrder.id}</Text>
          <Text style={styles.headerRate}>{activeOrder.pricePerKm} ₸/км</Text>
        </View>

        {/* Order info */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Ionicons name="location" size={20} color="#c8440a" />
            <Text style={styles.infoText}>{activeOrder.pickupAddress || "Адрес не указан"}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="call" size={20} color="#25D366" />
            <Text style={styles.infoText}>{activeOrder.phone}</Text>
            <TouchableOpacity style={styles.callBtn} onPress={callClient}>
              <Ionicons name="call" size={18} color="#fff" />
              <Text style={styles.callBtnText}>Позвонить</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Map View */}
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: lastLocationRef.current?.lat || 42.309, // Карамурт
              longitude: lastLocationRef.current?.lng || 69.969,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            showsUserLocation
            showsMyLocationButton
            mapType="none" // Use custom tiles
          >
            <UrlTile
              urlTemplate="https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU"
              maximumZ={19}
              flipY={false}
            />
            {lastLocationRef.current && (
              <Marker
                coordinate={{
                  latitude: lastLocationRef.current.lat,
                  longitude: lastLocationRef.current.lng,
                }}
                title="Я здесь"
              >
                <Ionicons name="car" size={30} color="#c8440a" />
              </Marker>
            )}
          </MapView>
        </View>

        {/* Trip meter (visible during in_progress) */}
        {activeOrder.status === "in_progress" && (
          <View style={styles.meterCard}>
            <View style={styles.meterRow}>
              <View style={styles.meterItem}>
                <Text style={styles.meterLabel}>📏 Расстояние</Text>
                <Text style={styles.meterValue}>{tripDistance.toFixed(1)} км</Text>
              </View>
              <View style={styles.meterItem}>
                <Text style={styles.meterLabel}>⏱ Время</Text>
                <Text style={styles.meterValue}>{tripElapsed} мин</Text>
              </View>
            </View>
            <Text style={styles.priceLabel}>💰 СТОИМОСТЬ</Text>
            <Text style={styles.priceValue}>{tripPrice} ₸</Text>
          </View>
        )}

        {/* Status buttons */}
        <View style={styles.statusActions}>
          {activeOrder.status === "assigned" && (
            <>
              <Text style={styles.statusHint}>
                📱 Позвоните клиенту, чтобы уточнить точное местоположение
              </Text>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#2196F3" }]}
                onPress={() => updateOrderStatus("arrived")}
                disabled={loading}
              >
                <Ionicons name="navigate" size={22} color="#fff" />
                <Text style={styles.actionBtnText}>Я НА МЕСТЕ</Text>
              </TouchableOpacity>
            </>
          )}

          {activeOrder.status === "arrived" && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#4CAF50" }]}
              onPress={() => updateOrderStatus("in_progress")}
              disabled={loading}
            >
              <Ionicons name="car" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>КЛИЕНТ СЕЛ — ПОЕХАЛИ</Text>
            </TouchableOpacity>
          )}

          {activeOrder.status === "in_progress" && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#c8440a" }]}
              onPress={() => {
                Alert.alert("Завершить поездку?", `Расстояние: ${tripDistance.toFixed(1)} км\nИтого: ${tripPrice} ₸`, [
                  { text: "Отмена", style: "cancel" },
                  { text: "Завершить", onPress: () => updateOrderStatus("completed") },
                ]);
              }}
              disabled={loading}
            >
              <Ionicons name="checkmark-circle" size={22} color="#fff" />
              <Text style={styles.actionBtnText}>ЗАВЕРШИТЬ ПОЕЗДКУ</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Bottom actions */}
        <View style={styles.bottomActions}>
          <TouchableOpacity
            style={styles.sosBtn}
            onPress={() => {
              const sock = getSocket();
              if (sock && lastLocationRef.current) {
                sock.emit("driver_alarm", {
                  driverId: profile.id,
                  lat: lastLocationRef.current.lat,
                  lng: lastLocationRef.current.lng,
                });
              }
              Alert.alert("🆘 SOS", "Сигнал отправлен диспетчеру!");
            }}
          >
            <Ionicons name="warning" size={20} color="#fff" />
            <Text style={styles.sosBtnText}>SOS</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelOrderBtn}
            onPress={() => {
              Alert.alert("Отменить заказ?", "", [
                { text: "Нет", style: "cancel" },
                { text: "Да, отменить", style: "destructive", onPress: () => updateOrderStatus("canceled") },
              ]);
            }}
          >
            <Text style={styles.cancelOrderBtnText}>Отменить</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── MAIN SCREEN ──────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={[styles.statusDot, isOnline ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.headerTitle}>
            {isOnline ? "На линии" : "Вне линии"}
          </Text>
        </View>
        <TouchableOpacity onPress={logout}>
          <Ionicons name="log-out-outline" size={24} color="#888" />
        </TouchableOpacity>
      </View>

      {/* Profile */}
      <View style={styles.profileCard}>
        <Text style={styles.profileName}>{profile.lastName} {profile.firstName}</Text>
        {profile.callsign && (
          <Text style={styles.callsign}>Позывной: {profile.callsign}</Text>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Баланс</Text>
          <Text style={styles.statValue}>{Number(profile.balance).toLocaleString()} ₸</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Рейтинг</Text>
          <Text style={styles.statValue}>{Number(profile.rating).toFixed(1)} ⭐</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Сегодня</Text>
          <Text style={styles.statValue}>{profile.todayOrders}</Text>
        </View>
      </View>

      {/* Center area / Map */}
      <View style={styles.centerArea}>
        {isOnline ? (
          <View style={styles.mapContainerWaiting}>
            <MapView
              style={styles.map}
              initialRegion={{
                latitude: lastLocationRef.current?.lat || 42.44,
                longitude: lastLocationRef.current?.lng || 69.83,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
              showsUserLocation
              mapType="none"
            >
              <UrlTile
                urlTemplate="https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU"
                maximumZ={19}
              />
            </MapView>
            <View style={styles.waitingOverlay}>
              <Ionicons name="radio-outline" size={48} color="#c8440a" />
              <Text style={styles.waitingText}>Ожидание заказа...</Text>
            </View>
          </View>
        ) : (
          <>
            <Ionicons name="moon-outline" size={64} color="#444" />
            <Text style={styles.offlineText}>Вы вне линии</Text>
            <Text style={styles.offlineHint}>Нажмите кнопку ниже, чтобы начать принимать заказы</Text>
          </>
        )}
      </View>

      {/* Toggle button */}
      <TouchableOpacity
        style={[styles.toggleBtn, isOnline ? styles.toggleOff : styles.toggleOn]}
        onPress={toggleOnline}
        disabled={loading}
        activeOpacity={0.8}
      >
        <Ionicons
          name={isOnline ? "power" : "flash"}
          size={24}
          color="#fff"
        />
        <Text style={styles.toggleBtnText}>
          {loading ? "..." : isOnline ? "УЙТИ С ЛИНИИ" : "ВЫЙТИ НА ЛИНИЮ"}
        </Text>
      </TouchableOpacity>

      {/* Today's earnings */}
      {profile.todayOrders > 0 && (
        <View style={styles.earningsBar}>
          <Text style={styles.earningsText}>
            Заработок за сегодня: {Number(profile.todayEarnings).toLocaleString()} ₸
          </Text>
        </View>
      )}

      {/* Bottom nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity style={styles.navItem} onPress={() => {}}>
          <Ionicons name="home" size={22} color="#c8440a" />
          <Text style={[styles.navLabel, { color: "#c8440a" }]}>Главная</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push("/history")}>
          <Ionicons name="list" size={22} color="#888" />
          <Text style={styles.navLabel}>История</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => router.push("/chat")}>
          <Ionicons name="chatbubble-ellipses" size={22} color="#888" />
          <Text style={styles.navLabel}>Чат</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={logout}>
          <Ionicons name="person" size={22} color="#888" />
          <Text style={styles.navLabel}>Выход</Text>
        </TouchableOpacity>
      </View>

      {/* ─── ORDER ALERT MODAL ─── */}
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
                <Text style={styles.alertText}>
                  {orderAlert?.pickupAddress || "Адрес не указан"}
                </Text>
              </View>
              <View style={styles.alertRow}>
                <Ionicons name="call" size={18} color="#25D366" />
                <Text style={styles.alertText}>
                  {orderAlert?.phone ? `${orderAlert.phone.slice(0, 8)}***` : "—"}
                </Text>
              </View>
              <View style={styles.alertRow}>
                <Ionicons name="speedometer" size={18} color="#2196F3" />
                <Text style={styles.alertText}>
                  {orderAlert?.pricePerKm || 80} ₸/км
                </Text>
              </View>
            </View>

            <View style={styles.timerCircle}>
              <Text style={styles.timerText}>{alertTimer}</Text>
            </View>

            <View style={styles.alertActions}>
              <TouchableOpacity
                style={[styles.alertBtn, { backgroundColor: "#4CAF50" }]}
                onPress={acceptOrder}
                disabled={loading}
              >
                <Ionicons name="checkmark" size={24} color="#fff" />
                <Text style={styles.alertBtnText}>ПРИНЯТЬ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.alertBtn, { backgroundColor: "#f44336" }]}
                onPress={rejectOrder}
              >
                <Ionicons name="close" size={24} color="#fff" />
                <Text style={styles.alertBtnText}>ОТКЛОНИТЬ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Haversine distance in km
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", paddingTop: 50, paddingHorizontal: 20 },
  loadingText: { color: "#888", textAlign: "center", marginTop: 100, fontSize: 16 },

  // Header
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  headerRate: { color: "#c8440a", fontSize: 14, fontWeight: "600" },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  dotOnline: { backgroundColor: "#4CAF50" },
  dotOffline: { backgroundColor: "#f44336" },

  // Profile
  profileCard: { backgroundColor: "#252540", borderRadius: 12, padding: 16, marginBottom: 16 },
  profileName: { color: "#fff", fontSize: 20, fontWeight: "700" },
  callsign: { color: "#c8440a", fontSize: 14, marginTop: 4 },

  // Stats
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: "#252540", borderRadius: 10, padding: 12, alignItems: "center" },
  statLabel: { color: "#888", fontSize: 11, marginBottom: 4 },
  statValue: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // Center
  centerArea: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  waitingText: { color: "#888", fontSize: 16 },
  offlineText: { color: "#666", fontSize: 18, fontWeight: "600" },
  offlineHint: { color: "#444", fontSize: 13, textAlign: "center", maxWidth: 240 },

  // Toggle
  toggleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 56, borderRadius: 14, marginBottom: 16 },
  toggleOn: { backgroundColor: "#4CAF50" },
  toggleOff: { backgroundColor: "#f44336" },
  toggleBtnText: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 0.5 },

  // Earnings
  earningsBar: { backgroundColor: "#252540", borderRadius: 10, padding: 12, marginBottom: 10, alignItems: "center" },
  earningsText: { color: "#4CAF50", fontSize: 14, fontWeight: "600" },

  // Map
  mapContainer: { flex: 1, borderRadius: 16, overflow: "hidden", marginBottom: 16, minHeight: 200 },
  mapContainerWaiting: { width: "100%", height: "100%", borderRadius: 16, overflow: "hidden" },
  map: { width: "100%", height: "100%" },
  waitingOverlay: { position: "absolute", top: 20, alignSelf: "center", backgroundColor: "rgba(26,26,46,0.8)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 10 },

  // Order info card
  card: { backgroundColor: "#252540", borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { color: "#fff", fontSize: 15, flex: 1 },
  callBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#25D366", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  callBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // Trip meter
  meterCard: { backgroundColor: "#252540", borderRadius: 16, padding: 20, marginBottom: 16, alignItems: "center", borderWidth: 1, borderColor: "#c8440a" },
  meterRow: { flexDirection: "row", gap: 24, marginBottom: 16 },
  meterItem: { alignItems: "center" },
  meterLabel: { color: "#888", fontSize: 12, marginBottom: 4 },
  meterValue: { color: "#fff", fontSize: 20, fontWeight: "700" },
  priceLabel: { color: "#888", fontSize: 12, marginBottom: 4 },
  priceValue: { color: "#c8440a", fontSize: 42, fontWeight: "800" },

  // Status actions
  statusActions: { gap: 12, marginBottom: 16 },
  statusHint: { color: "#888", fontSize: 13, textAlign: "center", marginBottom: 4 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 56, borderRadius: 14 },
  actionBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // Bottom
  bottomActions: { flexDirection: "row", justifyContent: "space-between", marginBottom: 30 },
  sosBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f44336", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  sosBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  cancelOrderBtn: { paddingHorizontal: 20, paddingVertical: 12 },
  cancelOrderBtnText: { color: "#888", fontSize: 14 },

  // Alert modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", paddingHorizontal: 24 },
  alertCard: { backgroundColor: "#252540", borderRadius: 20, padding: 24, borderWidth: 2, borderColor: "#c8440a" },
  alertHeader: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 20 },
  alertTitle: { color: "#c8440a", fontSize: 22, fontWeight: "800" },
  alertBody: { gap: 12, marginBottom: 20 },
  alertRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  alertText: { color: "#fff", fontSize: 15 },
  timerCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: "#c8440a", justifyContent: "center", alignItems: "center", alignSelf: "center", marginBottom: 20 },
  timerText: { color: "#c8440a", fontSize: 24, fontWeight: "800" },
  alertActions: { flexDirection: "row", gap: 12 },
  alertBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 12 },
  alertBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // Nav bar
  navBar: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: "#252540", paddingVertical: 10, marginHorizontal: -20, paddingHorizontal: 20 },
  navItem: { alignItems: "center", gap: 2 },
  navLabel: { color: "#888", fontSize: 10, fontWeight: "600" },
});
