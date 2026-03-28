"use client";
import { useEffect, useState } from "react";
import type { Driver } from "@/types";
import { DriverForm } from "@/components/drivers/DriverForm";

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);

  const loadDrivers = () => {
    setLoading(true);
    const q = search ? `&search=${encodeURIComponent(search)}` : "";
    fetch(`/api/drivers?${q}`)
      .then((r) => r.json())
      .then((d) => { if (d.data) setDrivers(d.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDrivers(); }, [search]);

  const STATUS_META: Record<string, { label: string; color: string }> = {
    free:    { label: "свободен",            color: "var(--status-free)" },
    busy:    { label: "на заказе",            color: "var(--status-busy)" },
    offline: { label: "не в сети",            color: "var(--status-offline)" },
  };

  const counts = {
    total:   drivers.length,
    online:  drivers.filter((d) => d.status !== "offline").length,
    free:    drivers.filter((d) => d.status === "free").length,
    busy:    drivers.filter((d) => d.status === "busy").length,
    offline: drivers.filter((d) => d.status === "offline").length,
  };

  return (
    <div className="page-content">
      {/* Status legend */}
      <div className="action-bar" style={{ flexWrap: "wrap", gap: 16 }}>
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <span key={key} className="flex-row" style={{ fontSize: 12 }}>
            <span className={`status-dot ${key}`} />
            {meta.label}: <strong>{counts[key as keyof typeof counts]}</strong>
          </span>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="form-input"
            style={{ width: 200 }}
            placeholder="Поиск водителя..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            id="driver-search"
          />
          <button className="btn btn-primary" onClick={() => { setEditDriver(null); setShowForm(true); }} id="btn-add-driver">
            + Добавить водителя
          </button>
          <button className="btn btn-ghost">+ Добавить группу</button>
          <a href="/api/drivers/export" className="btn btn-ghost">⬇ Экспорт в CSV</a>
        </div>
      </div>

      {/* Counters bar */}
      <div style={{ padding: "4px 10px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", fontSize: 12, color: "var(--color-text-2)" }}>
        Всего: <strong>{counts.total}</strong> | На линии: <strong>{counts.online}</strong> | Свободных: <strong>{counts.free}</strong> | На заказе: <strong>{counts.busy}</strong>
      </div>

      {/* Table */}
      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : drivers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚗</div>
            <div>Нет водителей</div>
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>Добавить первого водителя</button>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Очередь</th>
                <th>Статус</th>
                <th>Логин</th>
                <th>ФИО</th>
                <th>Позывной</th>
                <th>Телефон</th>
                <th>Автомобиль</th>
                <th>Тариф</th>
                <th>Баланс</th>
                <th>Рейтинг</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => {
                const statusMeta = STATUS_META[driver.status] || STATUS_META.offline;
                return (
                  <tr key={driver.id}>
                    <td className="text-muted text-sm">{driver.id}</td>
                    <td className="text-muted text-sm">—</td>
                    <td>
                      <span className="flex-row">
                        <span className={`status-dot ${driver.status}`} />
                        <span style={{ color: statusMeta.color, fontSize: 11 }}>{statusMeta.label}</span>
                      </span>
                    </td>
                    <td className="text-mono text-sm">{driver.login}</td>
                    <td>{driver.lastName} {driver.firstName} {driver.middleName || ""}</td>
                    <td className="text-muted">{driver.callsign || "—"}</td>
                    <td className="text-mono">{driver.phone}</td>
                    <td className="text-muted text-sm">—</td>
                    <td className="text-muted text-sm">—</td>
                    <td>
                      <span style={{ color: driver.balance < 0 ? "var(--status-offline)" : "inherit", fontWeight: driver.balance < 0 ? 700 : 400 }}>
                        {Number(driver.balance).toFixed(2)} ₽
                      </span>
                    </td>
                    <td>⭐ {Number(driver.rating).toFixed(1)}</td>
                    <td>
                      <div className="flex-row">
                        <button className="btn btn-ghost btn-sm" onClick={() => { setEditDriver(driver); setShowForm(true); }}>✏️</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--status-offline)" }}
                          onClick={async () => {
                            if (confirm("Удалить водителя?")) {
                              await fetch(`/api/drivers/${driver.id}`, { method: "DELETE" });
                              loadDrivers();
                            }
                          }}>✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* App download link */}
      <div style={{ padding: "6px 10px", borderTop: "1px solid var(--color-border)", fontSize: 12, color: "var(--color-text-3)" }}>
        Программа водителя (Android): <a href="#">Скачать APK</a>
      </div>

      {/* Driver Form Modal */}
      {showForm && (
        <DriverForm
          driver={editDriver}
          onClose={() => { setShowForm(false); setEditDriver(null); loadDrivers(); }}
        />
      )}
    </div>
  );
}
