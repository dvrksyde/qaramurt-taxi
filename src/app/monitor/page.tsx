"use client";
import { useMonitorStore } from "@/stores/monitorStore";
import { useSocket } from "@/stores/socketStore";
import { NewOrderModal } from "@/components/orders/NewOrderModal";
import { OrderDetailsModal } from "@/components/orders/OrderDetailsModal";
import { MonitorTabs } from "@/components/monitor/MonitorTabs";
import { CurrentOrdersTab } from "@/components/monitor/CurrentOrdersTab";
import { MapTab } from "@/components/monitor/MapTab";
import { ChatTab } from "@/components/monitor/ChatTab";
import { SystemTab } from "@/components/monitor/SystemTab";
import { useEffect } from "react";

export default function MonitorPage() {
  const { activeTab, isNewOrderOpen, openNewOrder, closeNewOrder, selectedOrderId, setSelectedOrderId } = useMonitorStore();
  const { connected } = useSocket();

  // Global keyboard shortcut: Alt+F1 → open new order
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "F1") {
        e.preventDefault();
        openNewOrder();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openNewOrder]);

  return (
    <div className="page-content">
      {/* Action Bar */}
      <div className="action-bar">
        <button
          className="btn btn-yellow"
          onClick={openNewOrder}
          id="btn-new-order"
        >
          + Новый заказ (Alt+F1)
        </button>
        <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>
          Входящая линия:{" "}
          <span style={{ color: connected ? "var(--status-free)" : "var(--status-offline)" }}>
            {connected ? "Онлайн" : "ошибка (Offline)"}
          </span>
        </span>
        <span className="text-muted" style={{ marginLeft: 16, fontSize: 12 }}>
          Очередь:
        </span>
      </div>

      {/* Sub-tabs */}
      <MonitorTabs />

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {activeTab === "current"   && <CurrentOrdersTab />}
        {activeTab === "map"       && <MapTab />}
        {activeTab === "chat"      && <ChatTab />}
        {activeTab === "system"    && <SystemTab />}
      </div>

      {/* New Order Modal */}
      {isNewOrderOpen && <NewOrderModal onClose={closeNewOrder} />}

      {/* Order Details Modal */}
      {selectedOrderId && (
        <OrderDetailsModal 
          orderId={selectedOrderId} 
          onClose={() => setSelectedOrderId(null)} 
        />
      )}
    </div>
  );
}
