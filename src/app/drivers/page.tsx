"use client";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import type { Driver } from "@/types";
import { DriverForm } from "@/components/drivers/DriverForm";
import { BalanceModal } from "@/components/drivers/BalanceModal";
import { useSocket } from "@/stores/socketStore";

export default function DriversPage() {
  const { data: session } = useSession();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDriver, setEditDriver] = useState<Driver | null>(null);
  const [balanceDriver, setBalanceDriver] = useState<Driver | null>(null);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState("status");
  const [sortDir, setSortDir] = useState("asc");

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
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);

    fetch(`/api/drivers?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.data) setDrivers(d.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [search, sortBy, sortDir]);

  useEffect(() => {
    loadDrivers();
  }, [loadDrivers]);

  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;
    const handleChange = () => loadDrivers(true);

    socket.on("driver_online", handleChange);
    socket.on("driver_offline", handleChange);
    socket.on("order_status_change", handleChange);
    socket.on("order_updated", handleChange);
    socket.on("driver_ratings_updated", handleChange);

    return () => {
      socket.off("driver_online", handleChange);
      socket.off("driver_offline", handleChange);
      socket.off("order_status_change", handleChange);
      socket.off("order_updated", handleChange);
      socket.off("driver_ratings_updated", handleChange);
    };
  }, [socket, loadDrivers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  };

  const sortIcon = (field: string) => {
    if (sortBy !== field) return <span className="sort-icon inactive">⇅</span>;
    return <span className="sort-icon">{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  return (
    <div className="page-content">
      <div style={{ padding: "8px 14px", marginBottom: 0, fontSize: 12, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <strong style={{ color: "var(--color-text)", marginRight: 8 }}>Статусы:</strong>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#00ff00" }} /> - свободен;</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#ffd700" }} /> - на заказе;</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--status-offline)" }} /> - не в сети;</span>
        </div>

        {canAdd && (
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--color-primary)", fontWeight: 600 }} onClick={() => { setEditDriver(null); setShowForm(true); }}>
            + Добавить водителя
          </button>
        )}
      </div>

      {/* Search filter */}
      <div className="filter-bar" style={{ padding: "12px 14px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
          <input
            className="form-input"
            placeholder="Поиск по имени, телефону или логину..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ maxWidth: 340 }}
          />
          <button type="submit" className="btn btn-primary btn-sm">Найти</button>
          {search && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setSearchInput(""); setSearch(""); }}
            >
              Сбросить
            </button>
          )}
          <span className="text-muted" style={{ marginLeft: "auto", fontSize: 12 }}>
            Всего: {drivers.length}
          </span>
        </form>
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
                <th rowSpan={2} style={{ textAlign: "center", cursor: "pointer" }} className="sortable-th" onClick={() => toggleSort("rating")}>
                  Рейтинг {sortIcon("rating")}
                </th>
                <th rowSpan={2}>Баланс</th>
                <th rowSpan={2}>Тариф</th>
                <th rowSpan={2}>Устройство</th>
                <th colSpan={3} style={{ textAlign: "center", borderBottom: "1px solid var(--color-border-2)", borderLeft: "1px solid var(--color-border-2)", borderRight: "1px solid var(--color-border-2)" }}>Автомобиль</th>
                {(canEdit || canDelete) && <th rowSpan={2} style={{ textAlign: "center", width: 80 }}>Действия</th>}
              </tr>
              <tr>
                <th style={{ textAlign: "center", borderLeft: "1px solid var(--color-border-2)", borderRight: "1px solid var(--color-border-2)", cursor: "pointer" }} className="sortable-th" onClick={() => toggleSort("plate")}>
                  г/н {sortIcon("plate")}
                </th>
                <th style={{ borderRight: "1px solid var(--color-border-2)" }}>Марка</th>
                <th style={{ borderRight: "1px solid var(--color-border-2)" }}>Цвет</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => {
                let statusColor = "var(--status-offline)";
                if (driver.status === "free") statusColor = "var(--status-free)";
                else if (driver.status === "busy") statusColor = "var(--status-busy)";

                const v = driver.vehicles?.[0];
                const isLowBalance = Number(driver.balance) < 100;

                return (
                  <tr key={driver.id} style={{ opacity: driver.isActive === false ? 0.5 : 1 }}>
                    <td style={{ textAlign: "center" }}>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: statusColor }} />
                    </td>
                    <td className="text-muted text-sm">{driver.id}</td>
                    <td className="text-mono text-sm">{driver.login}</td>
                    <td style={{ fontWeight: 500 }}>{driver.lastName} {driver.firstName}</td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      <span style={{ marginRight: 4 }}>🏆</span>
                      <strong style={{ color: "var(--color-text)" }}>{driver.rating}</strong>
                      <span style={{ color: "var(--color-text-3)", fontSize: 12, marginLeft: 6 }}>({driver.ordersCount || 0} поездок)</span>
                    </td>
                    <td style={{ verticalAlign: "middle" }}>
                      <button
                        onClick={() => setBalanceDriver(driver)}
                        style={{
                          background: "transparent",
                          color: isLowBalance ? "var(--status-offline)" : "var(--status-free)",
                          padding: "4px 10px",
                          borderRadius: "16px",
                          fontSize: "13px",
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                          border: `1px solid ${isLowBalance ? "var(--status-offline)" : "var(--status-free)"}`,
                          transition: "all 0.2s ease",
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.background = isLowBalance ? "rgba(232, 70, 70, 0.1)" : "rgba(61, 184, 74, 0.1)";
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {isLowBalance && <span style={{ fontSize: "14px" }}>⚠️</span>}
                        {Number(driver.balance).toLocaleString()} <span style={{ fontSize: "10px", opacity: 0.8 }}>₸</span>
                      </button>
                    </td>
                    <td className="text-muted text-sm">
                      <span style={{ background: "var(--color-bg)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--color-border)" }}>
                        {(driver as any).tariffGroup?.name || "Стандарт"}
                      </span>
                    </td>
                    <td className="text-muted text-sm" style={{ lineHeight: 1.4, padding: "8px 12px" }}>
                      <div style={{ color: "var(--color-text)", fontSize: "12px", marginBottom: 4 }}>
                        {driver.osVersion || "Android 14"}
                      </div>
                      <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginTop: 2 }}>
                        {driver.thirdPartyApps?.includes("yandex_pro") && (
                          <div title="Яндекс Про" style={{ width: 18, height: 18, borderRadius: 3, overflow: "hidden", border: "1px solid #ddd" }}>
                            <img src="https://play-lh.googleusercontent.com/1-h_9ICpS6kPUpT4Yp2D1h9n_yL_W2_X8_y_y_y_y_y_y_y_y_y_y" style={{ width: "100%", height: "100%" }} alt="Y" />
                          </div>
                        )}
                        {driver.thirdPartyApps?.includes("indrive") && (
                          <div title="inDrive" style={{ width: 18, height: 18, borderRadius: 3, overflow: "hidden", border: "1px solid #ddd" }}>
                            <img src="https://play-lh.googleusercontent.com/V7cAnYjntcE37Z1M1_08L_I_0j3z-4tX7g8J9X_3_y_y_y_y_y_y_y_y_y_y" style={{ width: "100%", height: "100%" }} alt="iD" />
                          </div>
                        )}
                        {driver.thirdPartyApps?.includes("taxomet") && (
                          <div title="Таксомет" style={{ width: 18, height: 18, borderRadius: 3, overflow: "hidden", border: "1px solid #ddd" }}>
                            <img src="https://play-lh.googleusercontent.com/uCyb95C5z_f_y_y_y_y_y_y_y_y_y_y_y_y_y_y_y_y_y_y_y_y" style={{ width: "100%", height: "100%" }} alt="T" />
                          </div>
                        )}
                        {driver.thirdPartyApps?.includes("salam_taxi") && (
                          <div title="SalamTaxi" style={{ width: 18, height: 18, borderRadius: 3, overflow: "hidden", border: "1px solid #ddd" }}>
                            <img src="https://play-lh.googleusercontent.com/Salam_Icon_Example" style={{ width: "100%", height: "100%" }} alt="S" />
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                      {v?.plate ? <span className="license-plate">{v.plate}</span> : <span className="text-muted text-sm">—</span>}
                    </td>
                    <td className="text-muted text-sm">{v ? `${v.make} ${v.model || ""}`.trim() : "—"}</td>
                    <td className="text-muted text-sm">{v?.color || "—"}</td>
                    {(canEdit || canDelete) && (
                      <td style={{ textAlign: "center" }}>
                        <div className="flex-row">
                          {canEdit && (
                            <button
                              className="btn btn-ghost btn-sm"
                              title={driver.isActive === false ? "Разблокировать" : "Заблокировать"}
                              onClick={async () => {
                                if (confirm(driver.isActive === false ? "Разблокировать водителя?" : "Заблокировать водителя? Он не сможет входить в приложение.")) {
                                  await fetch(`/api/drivers/${driver.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ isActive: !driver.isActive })
                                  });
                                  loadDrivers();
                                }
                              }}
                            >
                              {driver.isActive === false ? "✅" : "🚫"}
                            </button>
                          )}
                          {canEdit && (
                            <button className="btn btn-ghost btn-sm" title="Редактировать" onClick={() => { setEditDriver(driver); setShowForm(true); }}>✏️</button>
                          )}
                          {canDelete && (
                            <button
                              className="btn btn-ghost btn-sm text-danger"
                              title="Удалить"
                              onClick={async () => {
                                if (confirm("Вы уверены?")) {
                                  await fetch(`/api/drivers/${driver.id}`, { method: "DELETE" });
                                  loadDrivers();
                                }
                              }}
                            >🗑️</button>
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

      {showForm && (
        <DriverForm
          driver={editDriver}
          onClose={() => {
            setShowForm(false);
            setEditDriver(null);
            loadDrivers();
          }}
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
