import { useEffect, useState, useCallback } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
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

interface HistorySummary {
  grossProfit: number;
  companyCommission: number;
  netProfit: number;
  completedOrders: number;
  canceledOrders: number;
}

interface HistoryApiResult {
  data?: HistoryOrder[];
  summary?: HistorySummary;
  error?: string;
}

function FinanceDonut({ grossProfit, netProfit, companyCommission }: HistorySummary) {
  const size = 172;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeTotal = Math.max(grossProfit, 1);
  const netRatio = Math.min(1, Math.max(0, netProfit / safeTotal));
  const commissionRatio = Math.min(1, Math.max(0, companyCommission / safeTotal));

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartWrap}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#2f3156" strokeWidth={strokeWidth} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#4CAF50"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference * netRatio} ${circumference}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#c8440a"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference * commissionRatio} ${circumference}`}
            strokeDashoffset={-circumference * netRatio}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={styles.chartCenter}>
          <Text style={styles.chartCenterLabel}>Общая выручка</Text>
          <Text style={styles.chartCenterValue}>{grossProfit.toLocaleString()} ₸</Text>
        </View>
      </View>

      <View style={styles.legendList}>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: "#4CAF50" }]} />
          <Text style={styles.legendLabel}>Чистая прибыль</Text>
          <Text style={styles.legendValue}>{netProfit.toLocaleString()} ₸</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: "#c8440a" }]} />
          <Text style={styles.legendLabel}>Комиссия компании</Text>
          <Text style={styles.legendValue}>{companyCommission.toLocaleString()} ₸</Text>
        </View>
      </View>
    </View>
  );
}

export function DriverHistoryPanel() {
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"today" | "week" | "all">("today");
  const [summary, setSummary] = useState<HistorySummary>({
    grossProfit: 0,
    companyCommission: 0,
    netProfit: 0,
    completedOrders: 0,
    canceledOrders: 0,
  });

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const res = (await api(`/api/driver/orders/history?period=${period}&pageSize=50`)) as HistoryApiResult;
    setLoading(false);

    if (Array.isArray(res.data)) {
      setOrders(res.data);
    }

    if (res.summary) {
      setSummary({
        grossProfit: Number(res.summary.grossProfit) || 0,
        companyCommission: Number(res.summary.companyCommission) || 0,
        netProfit: Number(res.summary.netProfit) || 0,
        completedOrders: Number(res.summary.completedOrders) || 0,
        canceledOrders: Number(res.summary.canceledOrders) || 0,
      });
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
        <View style={[styles.statusBadge, item.status === "completed" ? styles.badgeCompleted : styles.badgeCanceled]}>
          <Ionicons name={item.status === "completed" ? "checkmark" : "close"} size={12} color="#fff" />
        </View>
      </View>

      <View style={styles.orderMiddle}>
        <Text style={styles.orderAddress} numberOfLines={1}>{item.pickupAddress || "—"}</Text>
        {item.distanceKm ? (
          <Text style={styles.orderDistance}>{Number(item.distanceKm).toFixed(1)} км · {item.pricePerKm} ₸/км</Text>
        ) : (
          <Text style={styles.orderDistance}>{item.dropoffAddress || "Без маршрута"}</Text>
        )}
      </View>

      <View style={styles.orderRight}>
        <Text style={[styles.orderPrice, item.status === "canceled" && styles.orderPriceCanceled]}>
          {item.finalPrice ? `${Number(item.finalPrice).toLocaleString()} ₸` : "—"}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>История заказов</Text>

      <View style={styles.tabs}>
        {(["today", "week", "all"] as const).map((p) => (
          <TouchableOpacity key={p} style={[styles.tab, period === p && styles.tabActive]} onPress={() => setPeriod(p)}>
            <Text style={[styles.tabText, period === p && styles.tabTextActive]}>
              {p === "today" ? "Сегодня" : p === "week" ? "Неделя" : "Все"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadHistory} tintColor="#c8440a" />}
        ListHeaderComponent={
          <>
            <View style={styles.summary}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Заказов</Text>
                <Text style={styles.summaryValue}>{orders.length}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Завершено</Text>
                <Text style={[styles.summaryValue, { color: "#4CAF50" }]}>{summary.completedOrders}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Отмена</Text>
                <Text style={[styles.summaryValue, { color: "#f44336" }]}>{summary.canceledOrders}</Text>
              </View>
            </View>

            <FinanceDonut {...summary} />
          </>
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
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", paddingHorizontal: 20, marginBottom: 16 },
  tabs: { flexDirection: "row", marginHorizontal: 20, marginBottom: 16, gap: 8 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: "#252540", alignItems: "center" },
  tabActive: { backgroundColor: "#c8440a" },
  tabText: { color: "#888", fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  summary: { flexDirection: "row", backgroundColor: "#252540", borderRadius: 12, padding: 16, marginBottom: 16, alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryDivider: { width: 1, height: 32, backgroundColor: "#333" },
  summaryLabel: { color: "#888", fontSize: 12, marginBottom: 4 },
  summaryValue: { color: "#fff", fontSize: 20, fontWeight: "800" },
  list: { paddingHorizontal: 20, paddingBottom: 20 },
  chartCard: { backgroundColor: "#252540", borderRadius: 16, padding: 18, marginBottom: 16 },
  chartWrap: { alignItems: "center", justifyContent: "center", marginBottom: 18 },
  chartCenter: { position: "absolute", alignItems: "center", justifyContent: "center", width: 110 },
  chartCenterLabel: { color: "#888", fontSize: 11, textAlign: "center", marginBottom: 4 },
  chartCenterValue: { color: "#fff", fontSize: 18, fontWeight: "800", textAlign: "center" },
  legendList: { gap: 10 },
  legendRow: { flexDirection: "row", alignItems: "center" },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  legendLabel: { flex: 1, color: "#cfd3ff", fontSize: 13 },
  legendValue: { color: "#fff", fontSize: 13, fontWeight: "700" },
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
