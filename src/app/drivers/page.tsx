"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { Driver } from "@/types";
import { DriverForm } from "@/components/drivers/DriverForm";

export default function DriversPage() {
  const { data: session } = useSession();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);

  // Extract permissions from session
  const user = session?.user as any;
  const role: string = user?.role || "operator";
  const permissions: string[] = user?.permissions || [];
  const isAdmin = role === "admin";

  const hasPerm = (perm: string) => isAdmin || permissions.includes(perm);
  const canAdd = hasPerm("add_drivers");
  const canEdit = hasPerm("edit_drivers");
  const canDelete = hasPerm("delete_drivers");

  const loadDrivers = () => {
    setLoading(true);
    fetch(`/api/drivers`)
      .then((r) => r.json())
      .then((d) => { if (d.data) setDrivers(d.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDrivers(); }, []);

  const maxOrders = Math.max(...drivers.map((d: any) => d.ordersCount || 0), 1);
  const calcRating = (count: number) => {
    if (!count) return 0.0;
    return (count / maxOrders) * 5.0;
  };

  return (
    <div className="page-content">
      {/* Status legend & Action Bar */}
      <div style={{ padding: "8px 14px", marginBottom: 0, fontSize: 12, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <strong style={{ color: "var(--color-text)", marginRight: 8 }}>Статусы:</strong>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#00ff00" }}/> - свободен;</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#ffd700" }}/> - на заказе;</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--status-offline)" }}/> - отключен / не в сети;</span>
        </div>

        {canAdd && (
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--color-primary)", fontWeight: 600 }} onClick={() => { setEditDriver(null); setShowForm(true); }} id="btn-add-driver">
            + Добавить водителя
          </button>
        )}
      </div>

      {/* Table */}
      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : drivers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚗</div>
            <div>Нет водителей</div>
            {canAdd && <button className="btn btn-primary" onClick={() => setShowForm(true)}>Добавить первого водителя</button>}
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

                return (
                  <tr key={driver.id}>
                    <td style={{ textAlign: "center" }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: statusColor }} />
                    </td>
                    <td className="text-muted text-sm">{driver.id}</td>
                    <td className="text-mono text-sm">{driver.login}</td>
                    <td style={{ fontWeight: 500 }}>{driver.lastName} {driver.firstName}</td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#f39c12", marginRight: 4 }}>⭐</span>
                      <strong style={{ color: "#2d3436" }}>{calcRating(driver.ordersCount || 0).toFixed(1)}</strong>
                      <span style={{ color: "#b2bec3", fontSize: 12, marginLeft: 6 }}>({driver.ordersCount || 0} зкз.)</span>
                    </td>
                    <td>
                      <span style={{ color: driver.balance < 0 ? "var(--status-offline)" : "inherit", fontWeight: driver.balance < 0 ? 700 : 400 }}>
                        {Number(driver.balance).toFixed(2)}
                      </span>
                    </td>
                    <td className="text-muted text-sm">{driver.deviceId || "—"}</td>
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
                              title="Удалить из базы данных"
                              onClick={async () => {
                                if (confirm("Вы уверены, что хотите удалить этого водителя навсегда?")) {
                                  try {
                                    const res = await fetch(`/api/drivers/${driver.id}`, { method: "DELETE" });
                                    const d = await res.json();
                                    if (!res.ok) {
                                      alert(d.error || "Ошибка удаления");
                                    }
                                    loadDrivers();
                                  } catch {
                                    alert("Ошибка сети");
                                  }
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
        )}
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
