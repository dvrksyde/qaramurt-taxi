"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { Driver } from "@/types";
import { DriverForm } from "@/components/drivers/DriverForm";
import { BalanceModal } from "@/components/drivers/BalanceModal";
import { useSocket } from "@/stores/socketStore";
import { useCallback } from "react";

export default function DriversPage() {
  const { data: session } = useSession();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);
  const [balanceDriver, setBalanceDriver] = useState<Driver | null>(null);

  // Extract permissions from session
  const user = session?.user as any;
  const role: string = user?.role || "operator";
  const permissions: string[] = user?.permissions || [];
  const isAdmin = role === "admin";

  const hasPerm = (perm: string) => isAdmin || permissions.includes(perm);
  const canAdd = hasPerm("add_drivers");
  const canEdit = hasPerm("edit_drivers");
  const canDelete = hasPerm("delete_drivers");

  const loadDrivers = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    fetch(`/api/drivers`)
      .then((r) => r.json())
      .then((d) => { if (d.data) setDrivers(d.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadDrivers(); }, [loadDrivers]);

  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;
    const handleChange = () => loadDrivers(true);
    
    socket.on("driver_online", handleChange);
    socket.on("driver_offline", handleChange);
    socket.on("order_status_change", handleChange);
    socket.on("order_updated", handleChange);
    
    return () => {
      socket.off("driver_online", handleChange);
      socket.off("driver_offline", handleChange);
      socket.off("order_status_change", handleChange);
      socket.off("order_updated", handleChange);
    };
  }, [socket, loadDrivers]);

  // Calculate driver ranks
  const sortedByOrders = [...drivers].sort((a, b) => (b.ordersCount || 0) - (a.ordersCount || 0));
  const driverRanks = new Map<number, number>();
  sortedByOrders.forEach((d, idx) => { driverRanks.set(d.id, idx + 1); });

  return (
    <div className="page-content">
      {/* Action Bar */}
      <div style={{ padding: "8px 14px", marginBottom: 0, fontSize: 12, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <strong style={{ color: "var(--color-text)", marginRight: 8 }}>Статусы:</strong>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#00ff00" }}/> - свободен;</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#ffd700" }}/> - на заказе;</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--status-offline)" }}/> - не в сети;</span>
        </div>

        {canAdd && (
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--color-primary)", fontWeight: 600 }} onClick={() => { setEditDriver(null); setShowForm(true); }}>
            + Добавить водителя
          </button>
        )}
      </div>

      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : drivers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚗</div>
            <div>Нет водителей</div>
            {canAdd && <button className="btn btn-primary" onClick={() => setShowForm(true)}>Добавить</button>}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th rowSpan={2} style={{ width: 40, textAlign: "center" }}></th>
                <th rowSpan={2}>ID</th>
                <th rowSpan={2}>Логин</th>
                <th rowSpan={2}>Имя</th>
                <th rowSpan={2} style={{ textAlign: "center" }}>Рейтинг</th>
                <th rowSpan={2}>Баланс</th>
                <th rowSpan={2}>Устройство</th>
                <th colSpan={3} style={{ textAlign: "center", borderBottom: "1px solid var(--color-border-2)" }}>Автомобиль</th>
                {(canEdit || canDelete) && <th rowSpan={2} style={{ textAlign: "center", width: 80 }}>Действия</th>}
              </tr>
              <tr>
                <th>г/н</th>
                <th>Марка</th>
                <th>Цвет</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => {
                let statusColor = "var(--status-offline)";
                if (driver.status === "free") statusColor = "#00ff00";
                else if (driver.status === "busy") statusColor = "#ffd700";

                const v = driver.vehicles?.[0];
                const isLowBalance = Number(driver.balance) < 100;

                return (
                  <tr key={driver.id}>
                    <td style={{ textAlign: "center" }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: statusColor }} />
                    </td>
                    <td className="text-muted text-sm">{driver.id}</td>
                    <td className="text-mono text-sm">{driver.login}</td>
                    <td style={{ fontWeight: 500 }}>{driver.lastName} {driver.firstName}</td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#f39c12", marginRight: 4 }}>🏆</span>
                      <strong style={{ color: "#2d3436" }}>{driverRanks.get(driver.id)}</strong>
                      <span style={{ color: "#b2bec3", fontSize: 12, marginLeft: 6 }}>({driver.ordersCount || 0} зкз.)</span>
                    </td>
                    <td style={{ verticalAlign: "middle" }}>
                      <button 
                        onClick={() => setBalanceDriver(driver)}
                        style={{ 
                          background: isLowBalance ? "#fff5f5" : "#f0fdf4",
                          color: isLowBalance ? "#e03131" : "#099268",
                          padding: "4px 10px",
                          borderRadius: "16px",
                          fontSize: "13px",
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                          border: `1px solid ${isLowBalance ? "#ffc9c9" : "#bbf7d0"}`,
                          transition: "all 0.2s ease"
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.transform = "translateY(-1px)";
                          e.currentTarget.style.boxShadow = "0 3px 6px rgba(0,0,0,0.1)";
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.transform = "none";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        {isLowBalance && <span style={{ fontSize: "14px" }}>⚠️</span>}
                        {Number(driver.balance).toLocaleString()} <span style={{ fontSize: "10px", opacity: 0.8 }}>₸</span>
                      </button>
                    </td>
                    <td className="text-muted text-sm" style={{ lineHeight: 1.4 }}>
                      <div style={{ color: "var(--color-primary)" }}>{(driver as any).osVersion || "Android"}</div>
                    </td>
                    <td className="text-mono text-sm">{v?.plate || "—"}</td>
                    <td className="text-muted text-sm">{v ? `${v.make} ${v.model || ""}`.trim() : "—"}</td>
                    <td className="text-muted text-sm">{v?.color || "—"}</td>
                    {(canEdit || canDelete) && (
                      <td style={{ textAlign: "center" }}>
                        <div className="flex-row">
                          {canEdit && (
                            <button className="btn btn-ghost btn-sm" title="Редактировать" onClick={() => { setEditDriver(driver); setShowForm(true); }}>✏️</button>
                          )}
                          {canDelete && (
                            <button className="btn btn-ghost btn-sm text-danger"
                              title="Удалить"
                              onClick={async () => {
                                if (confirm("Вы уверены?")) {
                                  await fetch(`/api/drivers/${driver.id}`, { method: "DELETE" });
                                  loadDrivers();
                                }
                              }}>🗑️</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) }
      </div>

      {/* Modals */}
      {showForm && (
        <DriverForm
          driver={editDriver}
          onClose={() => { setShowForm(false); setEditDriver(null); loadDrivers(); }}
        />
      )}

      {balanceDriver && (
        <BalanceModal
          driver={balanceDriver}
          onClose={() => setBalanceDriver(null)}
          onUpdate={loadDrivers}
        />
      )}
    </div>
  );
}
