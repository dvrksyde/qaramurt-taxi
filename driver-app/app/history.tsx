import { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "../services/api";

interface HistoryOrder {
  id: number;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  distanceKm: number | null;
  pricePerKm: number;
  finalPrice: number | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export default function HistoryScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"today" | "week" | "all">("today");
  const [totalEarnings, setTotalEarnings] = useState(0);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const res = await api(`/api/driver/orders/history?period=${period}&pageSize=50`);
    setLoading(false);
    if (res.data) {
      setOrders(res.data);
      const total = res.data.reduce(
        (sum: number, o: HistoryOrder) => sum + (Number(o.finalPrice) || 0),
        0
      );
      setTotalEarnings(total);
    }
  }, [period]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const renderOrder = ({ item }: { item: HistoryOrder }) => (
    <View style={styles.orderCard}>
      <View style={styles.orderLeft}>
        <Text style={styles.orderTime}>{formatTime(item.createdAt)}</Text>
        <View style={[
          styles.statusBadge,
          item.status === "completed" ? styles.badgeCompleted : styles.badgeCanceled,
        ]}>
          <Ionicons
            name={item.status === "completed" ? "checkmark" : "close"}
            size={12}
            color="#fff"
          />
        </View>
      </View>

      <View style={styles.orderMiddle}>
        <Text style={styles.orderAddress} numberOfLines={1}>
          📍 {item.pickupAddress || "—"}
        </Text>
        {item.distanceKm && (
          <Text style={styles.orderDistance}>
            {Number(item.distanceKm).toFixed(1)} км · {item.pricePerKm} ₸/км
          </Text>
        )}
      </View>

      <View style={styles.orderRight}>
        <Text style={[
          styles.orderPrice,
          item.status === "canceled" && styles.orderPriceCanceled,
        ]}>
          {item.finalPrice ? `${Number(item.finalPrice).toLocaleString()} ₸` : "—"}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>История заказов</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Period tabs */}
      <View style={styles.tabs}>
        {(["today", "week", "all"] as const).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.tab, period === p && styles.tabActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.tabText, period === p && styles.tabTextActive]}>
              {p === "today" ? "Сегодня" : p === "week" ? "Неделя" : "Все"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Summary */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Заказов</Text>
          <Text style={styles.summaryValue}>{orders.length}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Заработок</Text>
          <Text style={[styles.summaryValue, { color: "#4CAF50" }]}>
            {totalEarnings.toLocaleString()} ₸
          </Text>
        </View>
      </View>

      {/* Order list */}
      <FlatList
        data={orders}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadHistory} tintColor="#c8440a" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color="#444" />
            <Text style={styles.emptyText}>Нет заказов</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", paddingTop: 50 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 16 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },

  tabs: { flexDirection: "row", marginHorizontal: 20, marginBottom: 16, gap: 8 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: "#252540", alignItems: "center" },
  tabActive: { backgroundColor: "#c8440a" },
  tabText: { color: "#888", fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#fff" },

  summary: { flexDirection: "row", marginHorizontal: 20, backgroundColor: "#252540", borderRadius: 12, padding: 16, marginBottom: 16, alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryDivider: { width: 1, height: 32, backgroundColor: "#333" },
  summaryLabel: { color: "#888", fontSize: 12, marginBottom: 4 },
  summaryValue: { color: "#fff", fontSize: 20, fontWeight: "800" },

  list: { paddingHorizontal: 20, paddingBottom: 20 },

  orderCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#252540", borderRadius: 10, padding: 14, marginBottom: 10 },
  orderLeft: { alignItems: "center", marginRight: 12, gap: 4 },
  orderTime: { color: "#888", fontSize: 12, fontWeight: "600" },
  statusBadge: { width: 20, height: 20, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  badgeCompleted: { backgroundColor: "#4CAF50" },
  badgeCanceled: { backgroundColor: "#f44336" },
  orderMiddle: { flex: 1, gap: 2 },
  orderAddress: { color: "#fff", fontSize: 14 },
  orderDistance: { color: "#888", fontSize: 12 },
  orderRight: { marginLeft: 8 },
  orderPrice: { color: "#c8440a", fontSize: 16, fontWeight: "700" },
  orderPriceCanceled: { color: "#666", textDecorationLine: "line-through" },

  empty: { alignItems: "center", marginTop: 60, gap: 12 },
  emptyText: { color: "#666", fontSize: 16 },
});
