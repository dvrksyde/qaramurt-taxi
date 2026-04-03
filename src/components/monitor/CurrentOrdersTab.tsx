"use client";
import { useMonitorStore } from "@/stores/monitorStore";
import { useEffect } from "react";
import type { Order } from "@/types";

export function CurrentOrdersTab() {
  const { currentOrders, setCurrentOrders } = useMonitorStore();

  useEffect(() => {
    fetch("/api/orders?status=pending,assigned,arrived,in_progress")
      .then((r) => r.json())
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
            <th>Время</th>
            <th>Статус</th>
            <th>Телефон</th>
            <th>Откуда</th>
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
  const statusLabels: Record<string, string> = {
    pending: "Ожидает",
    assigned: "Назначен",
    arrived: "На месте",
    in_progress: "Везёт",
    completed: "Завершён",
    canceled: "Отменён",
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
    <tr>
      <td className="text-muted">
        {new Date(order.createdAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}
      </td>
      <td>
        <span className={`status-badge ${order.status}`}>
          {statusLabels[order.status] || order.status}
        </span>
      </td>
      <td className="text-mono">{order.phone}</td>
      <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {order.pickupAddress || "—"}
      </td>
      <td>
        {order.driver
          ? `${order.driver.lastName} ${order.driver.firstName[0]}.`
          : <span className="text-muted">—</span>}
      </td>
      <td>{order.class ? (order.class as { name: string }).name : "Любой"}</td>
      <td>
        <div className="flex-row">
          <button onClick={handleCancel} className="btn btn-ghost btn-sm" title="Отменить" style={{ color: "var(--status-offline)" }}>✕</button>
        </div>
      </td>
    </tr>
  );
}
