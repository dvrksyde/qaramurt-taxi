"use client";
import { useMonitorStore } from "@/stores/monitorStore";
import { useEffect } from "react";

type Tab = "current" | "scheduled" | "exchange" | "map" | "chat" | "system" | "alarms";

const TABS: { key: Tab; label: string; countKey?: keyof ReturnType<typeof useMonitorStore.getState>["counts"] }[] = [
  { key: "current",   label: "Текущие заказы",  countKey: "current" },
  { key: "map",       label: "Карта" },
  { key: "chat",      label: "Чат",              countKey: "chat" },
  { key: "leaderboard", label: "Рейтинг" },
  { key: "system",    label: "Системное",        countKey: "system" },
];

const VALID_TABS = ["current", "scheduled", "exchange", "map", "chat", "system", "alarms", "leaderboard"];

export function MonitorTabs() {
  const { activeTab, setActiveTab, counts } = useMonitorStore();

  // Restore saved tab after hydration
  useEffect(() => {
    const saved = localStorage.getItem("monitor_active_tab");
    if (saved && VALID_TABS.includes(saved) && saved !== activeTab) {
      setActiveTab(saved as Tab);
    }
  }, []);
  return (
    <div className="tabs-bar">
      {TABS.map((tab) => {
        const count = tab.countKey ? counts[tab.countKey] : undefined;
        return (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
            id={`tab-${tab.key}`}
          >
            {tab.label}
            {count !== undefined && (
              <span className={`tab-count ${count === 0 ? "zero" : ""}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}

      {/* Map controls (shown when map tab active) */}
      {activeTab === "map" && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, paddingRight: 10 }}>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" defaultChecked /> Группировать водителей
          </label>
          <button className="btn btn-ghost btn-sm">Имена</button>
        </div>
      )}
    </div>
  );
}
