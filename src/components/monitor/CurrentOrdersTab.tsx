"use client";
import { useMonitorStore } from "@/stores/monitorStore";
import { useEffect, useState } from "react";
import type { Order } from "@/types";

export function CurrentOrdersTab() {
  const { currentOrders, setCurrentOrders } = useMonitorStore();

  useEffect(() => {
    fetch("/api/orders?status=pending,assigned,arrived,in_progress")
      .then(async (r) => {
        const text = await r.text();
        if (!text) {
          console.warn("API /api/orders returned empty string. Status:", r.status);
          return { data: [] };
        }
        return JSON.parse(text);
      })
      .then((data) => data.data && setCurrentOrders(data.data))
      .catch(console.error);
  }, []);

  if (currentOrders.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <div>Нет текущих заказов</div>
        <div className="text-muted text-sm">Нажмите Alt+F1 чтобы создать новый заказ</div>
      </div>
    );
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ paddingLeft: 20, width: 210 }}>Статус</th>
            <th>Служба</th>
            <th>Телефон</th>
            <th>Откуда</th>
            <th>Куда</th>
            <th>Водитель</th>
            <th>Класс</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {currentOrders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderRow({ order }: { order: Order }) {
  const { setSelectedOrderId } = useMonitorStore();
  const statusLabels: Record<string, string> = {
    pending: "новый",
    assigned: "принят",
    arrived: "на месте",
    in_progress: "вып.-ся",
    completed: "завершён",
    canceled: "отменён",
  };

  const handleCancel = async () => {
    if (window.confirm("Вы уверены, что хотите отменить этот заказ?")) {
      try {
        await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
        // The socket 'order_status_change' event should broadcast the update and remove/update it from the list.
      } catch (err) {
        console.error("Failed to cancel order", err);
      }
    }
  };

  return (
    <tr
      onClick={() => setSelectedOrderId(order.id)}
      style={{ cursor: "pointer" }}
      className="clickable-row"
    >
      <td style={{ paddingLeft: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 15, whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {/* Icons based on automatic or manual (fallback to manual person icon) */}
            {order.distributionMethod === "automatic" ? (
              <img src="/icons/gear.png" alt="Auto" width="16" height="16" style={{ objectFit: "contain" }} />
            ) : (
              <img src="/icons/user.png" alt="Manual" width="16" height="16" style={{ objectFit: "contain" }} />
            )}

            <span style={{ fontSize: 13, color: "var(--color-text)" }}>
              {statusLabels[order.status] || order.status}
            </span>
          </div>

          <div style={{ minWidth: 46, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            <LiveOrderTimer order={order} />
          </div>
        </div>
      </td>
      <td className="text-muted">{order.service?.name || "—"}</td>
      <td className="text-mono">{order.phone}</td>
      <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {order.pickupAddress || "—"}
      </td>
      <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {order.dropoffAddress || "—"}
      </td>
      <td>
        {order.driver
          ? `${order.driver.lastName} ${order.driver.firstName[0]}.`
          : <span className="text-muted">—</span>}
      </td>
      <td>{order.class ? (order.class as { name: string }).name : "Любой"}</td>
      <td>
        <div className="flex-row">
          <button onClick={(e) => { e.stopPropagation(); handleCancel(); }} className="btn btn-ghost btn-sm" title="Отменить" style={{ color: "var(--status-offline)" }}>✕</button>
        </div>
      </td>
    </tr>
  );
}

function LiveOrderTimer({ order }: { order: Order }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const int = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(int);
  }, []);

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (order.status === "pending") {
    // 10 min countdown
    const created = new Date(order.createdAt).getTime();
    const elapsed = now - created;
    const rawRemaining = 10 * 60 * 1000 - elapsed;
    const isLate = rawRemaining < 0;
    const absRemaining = Math.abs(rawRemaining);
    const m = Math.floor(absRemaining / 60000);
    const s = Math.floor((absRemaining % 60000) / 1000);
    const color = isLate ? "var(--status-offline)" : "#6884a4";
    return <span style={{ color, letterSpacing: "0.5px" }}>{isLate ? "-" : ""}{pad(m)}:{pad(s)}</span>;
  }

  if (order.status === "assigned" || order.status === "arrived") {
    // 7 min countdown
    const assigned = order.assignedAt ? new Date(order.assignedAt).getTime() : new Date(order.createdAt).getTime();
    const elapsed = now - assigned;
    const rawRemaining = 7 * 60 * 1000 - elapsed;
    const isLate = rawRemaining < 0;
    const absRemaining = Math.abs(rawRemaining);
    const m = Math.floor(absRemaining / 60000);
    const s = Math.floor((absRemaining % 60000) / 1000);
    const color = isLate ? "var(--status-offline)" : "#6884a4";
    return <span style={{ color, letterSpacing: "0.5px" }}>{isLate ? "-" : ""}{pad(m)}:{pad(s)}</span>;
  }

  if (order.status === "in_progress") {
    // count up
    const started = order.startedAt ? new Date(order.startedAt).getTime() : (order.assignedAt ? new Date(order.assignedAt).getTime() : new Date(order.createdAt).getTime());
    const elapsed = Math.max(0, now - started);
    const m = Math.floor(elapsed / 60000);
    const s = Math.floor((elapsed % 60000) / 1000);
    return <span style={{ color: "#6884a4", letterSpacing: "0.5px" }}>{pad(m)}:{pad(s)}</span>;
  }

  return <span>{new Date(order.createdAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}</span>;
}
