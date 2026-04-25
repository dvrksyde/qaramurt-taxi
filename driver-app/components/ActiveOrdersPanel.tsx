import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  AppState,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../services/api";
import { useDriverStore } from "../stores/driverStore";
import { getSocket } from "../services/socket";
import { mapOrderToActiveOrder } from "../lib/orderPricing";

const BASE_FARE = 290;

interface AvailableOrder {
  id: number;
  phone: string;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  pricePerKm: number;
  createdAt: string;
  comment: string | null;
  service?: { id: number; name: string } | null;
  class?: { id: number; name: string } | null;
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff} сек назад`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} мин назад`;
  return `${Math.floor(mins / 60)} ч назад`;
}

export function ActiveOrdersPanel() {
  const [orders, setOrders] = useState<AvailableOrder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const { activeOrder, setActiveOrder, isOnline, orderAlert } = useDriverStore();

  const fetchOrders = useCallback(async () => {
    const res = await api("/api/driver/orders/available");
    if (res.data) {
      setOrders(res.data as AvailableOrder[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOrders();

    // Use socket events for real-time updates instead of polling
    // order_taken: instantly remove taken orders from the list
    // new_order_alert: a new order appeared, refresh the list
    const socket = getSocket();
    const handleOrderTaken = (data: { orderId: number }) => {
      setOrders((prev) => prev.filter((o) => o.id !== data.orderId));
    };
    const handleNewOrder = () => {
      fetchOrders();
    };

    if (socket) {
      socket.on("order_taken", handleOrderTaken);
      socket.on("new_order_alert", handleNewOrder);
    }

    return () => {
      if (socket) {
        socket.off("order_taken", handleOrderTaken);
        socket.off("new_order_alert", handleNewOrder);
      }
    };
  }, [fetchOrders]);

  // Instantly fetch orders when a new order alert comes in
  useEffect(() => {
    if (orderAlert) {
      fetchOrders();
    }
  }, [orderAlert, fetchOrders]);

  // Fetch orders right away when the app comes back to the foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") fetchOrders();
    });
    return () => sub.remove();
  }, [fetchOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }, [fetchOrders]);

  const acceptOrder = useCallback(
    async (orderId: number) => {
      setAcceptingId(orderId);
      const res = await api(`/api/driver/orders/${orderId}/accept`, {
        method: "POST",
      });
      setAcceptingId(null);

      if (res.error) {
        Alert.alert("Ошибка", res.error);
        fetchOrders(); // Refresh list — order might already be taken
        return;
      }

      if (res.data) {
        const order = res.data as any;
        const currentBaseFare = order.class?.name === "Комфорт" ? 390 : BASE_FARE;
        setActiveOrder(mapOrderToActiveOrder(order, currentBaseFare));
        Alert.alert("Успешно", "Заказ принят!");
      }
    },
    [fetchOrders, setActiveOrder]
  );

  const renderOrder = ({ item }: { item: AvailableOrder }) => (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <View style={styles.orderIdBadge}>
          <Text style={styles.orderIdText}>#{item.id}</Text>
        </View>
        <Text style={styles.timeAgo}>{timeAgo(item.createdAt)}</Text>
      </View>

      <View style={styles.orderBody}>
        <View style={styles.addressRow}>
          <View style={styles.iconDot}>
            <Ionicons name="ellipse" size={10} color="#4CAF50" />
          </View>
          <Text style={styles.addressText} numberOfLines={2}>
            {item.pickupAddress || "Адрес не указан"}
          </Text>
        </View>

        {item.dropoffAddress && (
          <View style={styles.addressRow}>
            <View style={styles.iconDot}>
              <Ionicons name="ellipse" size={10} color="#2196F3" />
            </View>
            <Text style={styles.addressText} numberOfLines={2}>
              {item.dropoffAddress}
            </Text>
          </View>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="speedometer-outline" size={14} color="#888" />
            <Text style={styles.metaText}>{Number(item.pricePerKm)} ₸/км</Text>
          </View>
          {item.class && (
            <View style={styles.metaItem}>
              <Ionicons name="car-outline" size={14} color="#888" />
              <Text style={styles.metaText}>{item.class.name}</Text>
            </View>
          )}
          {item.comment && (
            <View style={styles.metaItem}>
              <Ionicons name="chatbubble-outline" size={14} color="#888" />
              <Text style={styles.metaText} numberOfLines={1}>{item.comment}</Text>
            </View>
          )}
        </View>
      </View>

      <TouchableOpacity
        style={[
          styles.acceptBtn,
          acceptingId === item.id && styles.acceptBtnDisabled,
        ]}
        onPress={() => acceptOrder(item.id)}
        disabled={acceptingId !== null}
        activeOpacity={0.7}
      >
        {acceptingId === item.id ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.acceptBtnText}>Принять</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  if (activeOrder) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="car-sport" size={64} color="#FFD000" />
        <Text style={styles.emptyTitle}>У вас активный заказ</Text>
        <Text style={styles.emptySubtitle}>
          Пожалуйста, завершите текущий заказ, чтобы принимать новые заявки.
        </Text>
      </View>
    );
  }

  if (!isOnline) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="radio-outline" size={48} color="#555" />
        <Text style={styles.emptyTitle}>Вы не на линии</Text>
        <Text style={styles.emptySubtitle}>
          Выйдите на линию, чтобы видеть доступные заказы
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.emptyContainer}>
        <ActivityIndicator color="#c8440a" size="large" />
        <Text style={styles.emptySubtitle}>Загрузка заказов...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="receipt-outline" size={20} color="#fff" />
        <Text style={styles.headerTitle}>Доступные заказы</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{orders.length}</Text>
        </View>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderOrder}
        contentContainerStyle={orders.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#c8440a"
            colors={["#c8440a"]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyInner}>
            <Ionicons name="search-outline" size={48} color="#555" />
            <Text style={styles.emptyTitle}>Нет доступных заказов</Text>
            <Text style={styles.emptySubtitle}>
              Потяните вниз для обновления
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    flex: 1,
  },
  countBadge: {
    backgroundColor: "#FFD000",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 28,
    alignItems: "center",
  },
  countText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "800",
  },
  list: {
    paddingBottom: 20,
    gap: 12,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  orderCard: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "#1e1e1e",
    borderLeftWidth: 4,
    borderLeftColor: "#FFD000",
  },
  orderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  orderIdBadge: {
    backgroundColor: "rgba(255,208,0,0.1)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  orderIdText: {
    color: "#FFD000",
    fontSize: 13,
    fontWeight: "800",
  },
  timeAgo: {
    color: "#888",
    fontSize: 12,
    fontWeight: "600",
  },
  orderBody: {
    gap: 10,
    marginBottom: 14,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  iconDot: {
    paddingTop: 3,
  },
  addressText: {
    color: "#e0e0e0",
    fontSize: 15,
    flex: 1,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    color: "#aaa",
    fontSize: 13,
    fontWeight: "500",
  },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    backgroundColor: "#FFD000",
    borderRadius: 14,
  },
  acceptBtnDisabled: {
    opacity: 0.6,
  },
  acceptBtnText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "800",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyInner: {
    alignItems: "center",
    gap: 12,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },
  emptySubtitle: {
    color: "#888",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
