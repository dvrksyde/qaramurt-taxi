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
import * as Location from "expo-location";
import { registerForPushNotifications, showOrderNotification } from "../services/notifications";
import { DriverHistoryPanel } from "../components/DriverHistoryPanel";
import { DriverChatPanel } from "../components/DriverChatPanel";
import { DriverProfilePanel } from "../components/DriverProfilePanel";
import { ActiveOrdersPanel } from "../components/ActiveOrdersPanel";
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
  const [refreshingGPS, setRefreshingGPS] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const lastLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const tripDistanceRef = useRef(0);
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
      const nextCoords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setCurrentCoords(nextCoords);
      lastLocationRef.current = { lat: nextCoords.latitude, lng: nextCoords.longitude };

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
        accuracy: Location.Accuracy.High, // Снижаем точность на одну ступень для экономии батареи (High достаточно)
        distanceInterval: 15, // Обновлять только если авто проехал 15 метров (не срабатывает в пробке просто так)
        timeInterval: 5000, // И не чаще чем раз в 5 секунд (было 2 сек)
      },
      (loc) => {
        const { latitude: lat, longitude: lng } = loc.coords;
        const state = useDriverStore.getState();

        // Only recalculate price for non-fixed-price orders (taxi, not delivery)
        if (state.activeOrder?.status === "in_progress" && lastLocationRef.current && !state.activeOrder.isFixedPrice) {
          const d = haversine(lastLocationRef.current.lat, lastLocationRef.current.lng, lat, lng);
          const speed = loc.coords.speed; // speed in m/s
          const isMoving = speed !== null ? speed > 1.0 : true; // > 3.6 km/h

          // Ignore GPS drift — only count movement > 20 meters and actual speed
          if (d > 0.02 && isMoving) {
            tripDistanceRef.current += d;
            const price = roundTo5(BASE_FARE + tripDistanceRef.current * Number(state.activeOrder.pricePerKm));
            useDriverStore.getState().setTripMeter(tripDistanceRef.current, price);
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
      setTripMeter(0, activeOrder.isFixedPrice ? activeOrder.estimatedPrice! : BASE_FARE);
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
          {/* Header: order id + rate + GPS + ⋯ menu */}
          <View style={styles.orderHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.orderHeaderTitle}>  Заказ №{activeOrder.id}</Text>
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
                {refreshingGPS ? "Обновление..." : "Обновить GPS"}
              </Text>
            </TouchableOpacity>

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
              <Ionicons name="location" size={16} color="#FFD000" />
              <Text style={styles.addressLineText} numberOfLines={1}>{activeOrder.pickupAddress || "Адрес не указан"}</Text>
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

            {/* Navigator button — full width */}
            <TouchableOpacity style={styles.navBtn} onPress={openNavigator} activeOpacity={0.85}>
              <Ionicons name="navigate" size={18} color="#000000ff" />
              <Text style={styles.navBtnText}>
                {
                  activeOrder.status === "assigned"
                    ? "Открыть навигатор → К клиенту"
                    : activeOrder.status === "arrived"
                      ? "Открыть навигатор → К назначению"
                      : activeOrder.status === "in_progress"
                        ? "Открыть навигатор → К назначению"
                        : "Открыть навигатор"
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
              {activeOrder.status === 'assigned' ? "Подача автомобиля..." :
                activeOrder.status === 'arrived' ? "Ожидание клиента..." :
                  "В пути..."}
            </Text>

            <View style={styles.paymentBadge}>
              <Ionicons name="cash-outline" size={16} color="#22c55e" />
              <Text style={styles.paymentBadgeText}>Оплата наличными</Text>
            </View>
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
                color="#FFD000"
                iconName="navigate"
                disabled={loading}
              />
            )}
            {activeOrder.status === "arrived" && (
              <SwipeButton
                title="Клиент сел — поехали"
                onSwipeComplete={() => updateOrderStatus("in_progress")}
                color="#FFD000"
                iconName="car"
                disabled={loading}
              />
            )}
            {activeOrder.status === "in_progress" && (
              <SwipeButton
                title="Завершить поездку"
                onSwipeComplete={() => updateOrderStatus("completed")}
                color="#ffd000ff"
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
              {isOnline ? "Ожидание заказа..." : "Вы вне линии"}
            </Text>
            {currentCoords ? (
              <Text style={styles.gpsStatusCoords}>
                📍 {currentCoords.latitude.toFixed(5)}, {currentCoords.longitude.toFixed(5)}
              </Text>
            ) : (
              <Text style={styles.gpsStatusCoords}>Поиск GPS...</Text>
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
                {refreshingGPS ? "Обновление..." : "Обновить GPS"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.homeSwipeContainer}>
          <SwipeButton
            title={loading ? "..." : isOnline ? "Уйти с линии" : "Выйти на линию"}
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
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── Layout ───────────────────────────────────────────────
  container: { flex: 1, backgroundColor: "#0a0a0a", paddingTop: 44 },
  contentArea: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0a0a0a" },
  loadingText: { color: "#666", fontSize: 16 },
  pageBlock: { flex: 1, paddingHorizontal: 16, paddingBottom: 90 },

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

  // ─── GPS status card (center area) ────────────────────────
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

  // ─── Status Center Overlay ────────────────────────────────
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

  orderActions: { position: "absolute", bottom: Platform.OS === "ios" ? 110 : 22, left: 16, right: 16 },
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
});
