"use client";
import { useEffect, useState, useCallback } from "react";
import type { Order } from "@/types";

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает", assigned: "Назначен", arrived: "На месте",
  in_progress: "Везёт", completed: "Завершён", canceled: "Отменён",
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
  const [dateFrom,   setDateFrom]   = useState(today + " 00:00");
  const [dateTo,     setDateTo]     = useState(today + " 23:59");
  const [status,     setStatus]     = useState("");
  const [phone,      setPhone]      = useState("");
  const [address,    setAddress]    = useState("");
  const [driverId,   setDriverId]   = useState("");
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

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom)   params.set("dateFrom",   new Date(dateFrom).toISOString());
    if (dateTo)     params.set("dateTo",     new Date(dateTo).toISOString());
    if (status)     params.set("status",     status);
    if (phone.trim())    params.set("phone",      phone.trim());
    if (address.trim())  params.set("address",    address.trim());
    if (driverId)   params.set("driverId",   driverId);
    if (operatorId) params.set("operatorId", operatorId);
    params.set("pageSize", "200");

    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((d) => { if (d.data) { setOrders(d.data); setTotal(d.total || 0); } })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, status, phone, address, driverId, operatorId]);

  useEffect(() => { load(); }, []);

  const handleReset = () => {
    setDateFrom(today + " 00:00");
    setDateTo(today + " 23:59");
    setStatus("");
    setPhone("");
    setAddress("");
    setDriverId("");
    setOperatorId("");
  };

  return (
    <div className="page-content">
      {/* ── Filter bar ── */}
      <div className="journal-filters">
        {/* Row 1: Date range + status */}
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
        </div>

        {/* Row 2: Phone, Address, Driver, Dispatcher */}
        <div className="journal-filter-row">
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
        </div>

        {/* Action row */}
        <div className="journal-filter-row" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={load} id="journal-search">🔍 Показать</button>
            <button className="btn btn-ghost" onClick={handleReset} id="journal-reset">✕ Сбросить</button>
            <span className="text-muted text-sm">
              Найдено: <strong>{total}</strong>
            </span>
          </div>
          <button className="btn btn-ghost" id="journal-csv">⬇ CSV</button>
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
                <th>Дата/время</th>
                <th>Статус</th>
                <th>Служба</th>
                <th>Телефон</th>
                <th>Откуда</th>
                <th>Куда</th>
                <th>Водитель</th>
                <th>Диспетчер</th>
                <th>Класс</th>
                <th>Расст., км</th>
                <th>Итого, ₸</th>
                <th>Метод</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="text-mono text-sm">{o.id}</td>
                  <td className="text-muted nowrap" style={{ fontSize: 11 }}>
                    {new Date(o.createdAt).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td><span className={`status-badge ${o.status}`}>{STATUS_LABELS[o.status]}</span></td>
                  <td>{o.service?.name || "—"}</td>
                  <td className="text-mono">{o.phone}</td>
                  <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={o.pickupAddress || ""}>{o.pickupAddress || "—"}</td>
                  <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={o.dropoffAddress || ""}>{o.dropoffAddress || "—"}</td>
                  <td>
                    {o.driver
                      ? `${o.driver.lastName} ${o.driver.firstName[0]}.`
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-muted text-sm">
                    {(o as any).operator?.name || "—"}
                  </td>
                  <td className="text-muted text-sm">{(o.class as { name?: string } | undefined)?.name || "—"}</td>
                  <td className="text-mono">{o.distanceKm ? Number(o.distanceKm).toFixed(1) : "—"}</td>
                  <td className="text-mono">
                    {o.finalPrice != null ? Number(o.finalPrice).toFixed(0)
                      : o.estimatedPrice != null ? `~${Number(o.estimatedPrice).toFixed(0)}`
                      : "—"}
                  </td>
                  <td className="text-muted text-sm">{o.distributionMethod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
