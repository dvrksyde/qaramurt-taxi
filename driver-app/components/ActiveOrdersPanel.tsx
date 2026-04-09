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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../services/api";
import { useDriverStore } from "../stores/driverStore";
import { getSocket } from "../services/socket";

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
  const { setActiveOrder, isOnline } = useDriverStore();

  const fetchOrders = useCallback(async () => {
    const res = await api("/api/driver/orders/available");
    if (res.data) {
      setOrders(res.data as AvailableOrder[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);

    // Listen for real-time order_taken events to instantly remove taken orders
    const socket = getSocket();
    const handleOrderTaken = (data: { orderId: number }) => {
      setOrders((prev) => prev.filter((o) => o.id !== data.orderId));
    };
    if (socket) {
      socket.on("order_taken", handleOrderTaken);
    }

    return () => {
      clearInterval(interval);
      if (socket) {
        socket.off("order_taken", handleOrderTaken);
      }
    };
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
        setActiveOrder({
          ...order,
          distanceKm: Number(order.distanceKm) || 0,
          currentPrice: Number(order.finalPrice) || 290,
          pricePerKm: Number(order.pricePerKm) || 80,
        });
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
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    flex: 1,
  },
  countBadge: {
    backgroundColor: "#c8440a",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 28,
    alignItems: "center",
  },
  countText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
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
    backgroundColor: "#252540",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#c8440a",
  },
  orderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  orderIdBadge: {
    backgroundColor: "rgba(200,68,10,0.15)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  orderIdText: {
    color: "#c8440a",
    fontSize: 13,
    fontWeight: "700",
  },
  timeAgo: {
    color: "#888",
    fontSize: 12,
  },
  orderBody: {
    gap: 8,
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
    color: "#fff",
    fontSize: 14,
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
    gap: 4,
  },
  metaText: {
    color: "#888",
    fontSize: 12,
  },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    backgroundColor: "#4CAF50",
    borderRadius: 12,
  },
  acceptBtnDisabled: {
    opacity: 0.6,
  },
  acceptBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
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
    fontSize: 16,
    fontWeight: "600",
  },
  emptySubtitle: {
    color: "#888",
    fontSize: 14,
    textAlign: "center",
  },
});
