"use client";
import { useEffect, useState, useCallback } from "react";
import type { Order } from "@/types";
import { useSocket } from "@/stores/socketStore";

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает", assigned: "Назначен", arrived: "На месте",
  in_progress: "Везёт", completed: "Завершён", canceled: "Отменён",
};

const formatDateTime = (dateStr: string | Date | null | undefined) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yy = d.getFullYear().toString().slice(-2);
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${dd}.${mm}.${yy} ${hh}:${min}`;
};

interface DriverOption { id: number; firstName: string; lastName: string; callsign: string | null }
interface OperatorOption { id: number; name: string }

export default function JournalPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Lookup data for dropdowns
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [operators, setOperators] = useState<OperatorOption[]>([]);

  // Filters
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(today + " 00:00");
  const [dateTo, setDateTo] = useState(today + " 23:59");
  const [status, setStatus] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [driverId, setDriverId] = useState("");
  const [operatorId, setOperatorId] = useState("");

  // Load lookup data on mount
  useEffect(() => {
    fetch("/api/drivers?pageSize=500")
      .then((r) => r.json())
      .then((d) => { if (d.data) setDrivers(d.data); })
      .catch(console.error);

    fetch("/api/operators")
      .then((r) => r.json())
      .then((d) => { if (d.data) setOperators(d.data); })
      .catch(console.error);
  }, []);

  const load = useCallback((overrides?: { from?: string, to?: string }, silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();

    const finalFrom = overrides?.from ?? dateFrom;
    const finalTo = overrides?.to ?? dateTo;

    if (finalFrom) params.set("dateFrom", new Date(finalFrom).toISOString());
    if (finalTo) params.set("dateTo", new Date(finalTo).toISOString());
    if (status) params.set("status", status);
    if (phone.trim()) params.set("phone", phone.trim());
    if (address.trim()) params.set("address", address.trim());
    if (driverId) params.set("driverId", driverId);
    if (operatorId) params.set("operatorId", operatorId);
    params.set("pageSize", "200");

    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((d) => { if (d.data) { setOrders(d.data); setTotal(d.total || 0); } })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, status, phone, address, driverId, operatorId]);

  useEffect(() => { load(); }, []);

  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;
    const handleOrderChange = () => load(undefined, true);
    
    socket.on("new_order", handleOrderChange);
    socket.on("order_updated", handleOrderChange);
    socket.on("order_status_change", handleOrderChange);
    
    return () => {
      socket.off("new_order", handleOrderChange);
      socket.off("order_updated", handleOrderChange);
      socket.off("order_status_change", handleOrderChange);
    };
  }, [socket, load]);

  const handleReset = () => {
    setDateFrom(today + " 00:00");
    setDateTo(today + " 23:59");
    setStatus("");
    setPhone("");
    setAddress("");
    setDriverId("");
    setOperatorId("");
  };

  const setQuickDate = (range: string) => {
    const now = new Date();
    let from = new Date();
    let to = new Date();

    switch (range) {
      case 'today':
        break;
      case 'yesterday':
        from.setDate(now.getDate() - 1);
        to.setDate(now.getDate() - 1);
        break;
      case 'this_week':
        const day = now.getDay() || 7;
        from.setDate(now.getDate() - day + 1);
        break;
      case 'last_week':
        const dayLast = now.getDay() || 7;
        from.setDate(now.getDate() - dayLast - 6);
        to.setDate(now.getDate() - dayLast);
        break;
      case 'this_month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last_month':
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
    }

    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);

    const fmt = (d: Date) => {
      const pad = (n: number) => n.toString().padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const fromStr = fmt(from);
    const toStr = fmt(to);
    setDateFrom(fromStr);
    setDateTo(toStr);
    load({ from: fromStr, to: toStr });
  };

  const [expandedDriverId, setExpandedDriverId] = useState<number | null>(null);

  useEffect(() => {
    if (expandedDriverId === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedDriverId(null);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".driver-popup-container")) {
        setExpandedDriverId(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [expandedDriverId]);

  return (
    <div className="page-content">
      {/* ... previous filter code ... */}
      <div className="journal-filters">
        {/* Row 1: Date Range & Quick Buttons */}
        <div className="journal-filter-row">
          <div className="filter-group">
            <label className="filter-label" htmlFor="journal-from">Период с</label>
            <input type="datetime-local" className="form-input" style={{ width: 175 }} value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)} id="journal-from" />
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="journal-to">по</label>
            <input type="datetime-local" className="form-input" style={{ width: 175 }} value={dateTo}
              onChange={(e) => setDateTo(e.target.value)} id="journal-to" />
          </div>

          {/* Move slightly left to be closer to the "по" input */}
          <div className="filter-group" style={{ marginLeft: -90 }}>
            <label className="filter-label" style={{ opacity: 0 }}>Быстрые фильтры</label>
            <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
              {([
                { id: "today", label: "Сегодня" },
                { id: "yesterday", label: "Вчера" },
                { id: "this_week", label: "За неделю" },
                { id: "last_week", label: "За пред. неделю" },
                { id: "this_month", label: "За месяц" },
                { id: "last_month", label: "За пред. месяц" }
              ]).map(btn => (
                <button
                  key={btn.id}
                  onClick={() => setQuickDate(btn.id)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "14px",
                    border: "1px solid var(--color-border)",
                    background: "#f9fafb",
                    fontSize: 11,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                    color: "var(--color-text-2)",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-primary)";
                    e.currentTarget.style.color = "var(--color-primary)";
                    e.currentTarget.style.background = "#fff";
                    e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-border)";
                    e.currentTarget.style.color = "var(--color-text-2)";
                    e.currentTarget.style.background = "#f9fafb";
                    e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Status, Phone, Address, Driver, Dispatcher */}
        <div className="journal-filter-row">
          <div className="filter-group">
            <label className="filter-label" htmlFor="journal-status">Статус</label>
            <select className="form-select" style={{ width: 150 }} value={status}
              onChange={(e) => setStatus(e.target.value)} id="journal-status">
              <option value="">Все статусы</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>


          <div className="filter-group">
            <label className="filter-label" htmlFor="journal-phone">Телефон</label>
            <input type="text" className="form-input" style={{ width: 155 }} value={phone}
              onChange={(e) => setPhone(e.target.value)} id="journal-phone"
              placeholder="+7..." />
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="journal-address">Адрес</label>
            <input type="text" className="form-input" style={{ width: 200 }} value={address}
              onChange={(e) => setAddress(e.target.value)} id="journal-address"
              placeholder="Откуда / куда" />
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="journal-driver">Водитель</label>
            <select className="form-select" style={{ width: 180 }} value={driverId}
              onChange={(e) => setDriverId(e.target.value)} id="journal-driver">
              <option value="">Все водители</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.callsign ? `[${d.callsign}] ` : ""}{d.lastName} {d.firstName}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-label" htmlFor="journal-dispatcher">Диспетчер</label>
            <select className="form-select" style={{ width: 170 }} value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)} id="journal-dispatcher">
              <option value="">Все диспетчеры</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>{op.name}</option>
              ))}
            </select>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "flex-end" }}>
            <span className="text-muted text-sm" style={{ paddingBottom: "5.5px" }}>
              Найдено: <strong>{total}</strong>
            </span>
            <button className="btn btn-ghost" onClick={handleReset} id="journal-reset" style={{ height: "29px" }}>✕ Сбросить</button>
            <button className="btn btn-primary" onClick={() => load()} id="journal-search" style={{ height: "29px" }}>🔍 Показать</button>
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📖</div>
            <div>Нет заказов за выбранный период</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Время (Д/З)</th>
                <th>Статус</th>
                <th>Служба</th>
                <th>Телефон</th>
                <th>Откуда</th>
                <th>Куда</th>
                <th>Водитель</th>
                <th>Диспетчер</th>
                <th>Расст., км</th>
                <th>Итого, ₸</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="text-mono text-sm">{o.id}</td>
                  <td className="nowrap" style={{ fontSize: 11, lineHeight: 1.2 }}>
                    <div>Д: {formatDateTime(o.createdAt)}</div>
                    {o.completedAt && <div style={{ color: "var(--color-primary)" }}>З: {formatDateTime(o.completedAt)}</div>}
                  </td>
                  <td><span className={`status-badge ${o.status}`}>{STATUS_LABELS[o.status]}</span></td>
                  <td style={{ fontSize: 12, fontWeight: 500 }}>
                    {o.service?.name?.toLowerCase().includes("доставка") ? "Доставка" : "Qaramurt Taxi"}
                  </td>
                  <td className="text-mono">{o.phone}</td>
                  <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={o.pickupAddress || ""}>{o.pickupAddress || "—"}</td>
                  <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={o.dropoffAddress || ""}>{o.dropoffAddress || "—"}</td>
                  <td>
                    {o.driver ? (
                      <div className="driver-popup-container" style={{ position: "relative" }}>
                        <button
                          className="btn-link"
                          style={{ fontWeight: 600, textAlign: "left", padding: 0 }}
                          onClick={() => setExpandedDriverId(expandedDriverId === o.id ? null : o.id)}
                        >
                          {o.driver.lastName} {o.driver.firstName[0]}.
                        </button>
                        {expandedDriverId === o.id && (
                          <div style={{
                            position: "absolute", zIndex: 100, top: "100%", left: 0,
                            background: "#fff", padding: 10, borderRadius: 8,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.15)", minWidth: 180,
                            border: "1px solid var(--color-border)"
                          }}>
                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: "var(--color-primary)" }}>
                              {o.driver.lastName} {o.driver.firstName}
                            </div>
                            <div style={{ fontSize: 12, marginBottom: 4 }}>
                              📞 <strong>{o.driver.phone || "—"}</strong>
                            </div>
                            {o.driver.vehicles?.[0] && (
                              <div style={{ fontSize: 11, color: "#666", lineHeight: 1.4 }}>
                                🚗 {o.driver.vehicles[0].color} {o.driver.vehicles[0].make} {o.driver.vehicles[0].model}<br />
                                <strong style={{ color: "#333" }}>{o.driver.vehicles[0].plate}</strong>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-muted text-sm">
                    {(o as any).operator?.name || "—"}
                  </td>
                  <td className="nowrap">
                    {Number(o.distanceKm || 0) > 0
                      ? <><span className="text-mono">{Number(o.distanceKm).toFixed(1)}</span> <span style={{ fontSize: 10, opacity: 0.7 }}>км</span></>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="nowrap" style={{ fontSize: 11, lineHeight: 1.4 }}>
                    {(() => {
                      const price = Number(o.finalPrice || o.estimatedPrice || 0);
                      return (
                        <>
                          <div style={{ color: "#444" }}>Оплачено: <strong style={{ color: "#000" }}>{price.toLocaleString()}</strong></div>
                          <div style={{ color: "#666" }}>Комиссия: <strong>{(price * 0.1).toFixed(0)}</strong></div>
                          <div style={{ color: "#666" }}>Водителю: <strong>{(price * 0.9).toFixed(0)}</strong></div>
                        </>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
