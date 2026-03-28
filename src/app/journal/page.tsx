"use client";
import { useEffect, useState } from "react";
import type { Order } from "@/types";

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает", assigned: "Назначен", arrived: "На месте",
  in_progress: "Везёт", completed: "Завершён", canceled: "Отменён",
};

export default function JournalPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filters
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(today + " 00:00");
  const [dateTo,   setDateTo]   = useState(today + " 23:59");
  const [status,   setStatus]   = useState("");

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
    if (dateTo)   params.set("dateTo",   new Date(dateTo).toISOString());
    if (status)   params.set("status",   status);
    params.set("pageSize", "100");

    fetch(`/api/orders?${params}`)
      .then((r) => r.json())
      .then((d) => { if (d.data) { setOrders(d.data); setTotal(d.total || 0); } })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="page-content">
      {/* Filter bar */}
      <div className="action-bar" style={{ flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 12 }}>Период с</span>
        <input type="datetime-local" className="form-input" style={{ width: 165 }} value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)} id="journal-from" />
        <span style={{ fontSize: 12 }}>по</span>
        <input type="datetime-local" className="form-input" style={{ width: 165 }} value={dateTo}
          onChange={(e) => setDateTo(e.target.value)} id="journal-to" />

        <select className="form-select" style={{ width: 140 }} value={status}
          onChange={(e) => setStatus(e.target.value)} id="journal-status">
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <button className="btn btn-primary" onClick={load}>🔍 Показать</button>
        <span className="text-muted text-sm" style={{ marginLeft: 8 }}>
          Всего строк: <strong>{total}</strong>
        </span>
        <button className="btn btn-ghost" style={{ marginLeft: "auto" }}>⬇ CSV</button>
      </div>

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
                <th>Класс</th>
                <th>Расст., км</th>
                <th>Оценка</th>
                <th>Итого, ₽</th>
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
                  <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.pickupAddress || "—"}</td>
                  <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.dropoffAddress || "—"}</td>
                  <td>
                    {o.driver
                      ? `${o.driver.lastName} ${o.driver.firstName[0]}.`
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-muted text-sm">{(o.class as { name?: string } | undefined)?.name || "—"}</td>
                  <td className="text-mono">{o.distanceKm ? Number(o.distanceKm).toFixed(1) : "—"}</td>
                  <td className="text-muted">—</td>
                  <td className="text-mono">
                    {o.finalPrice != null ? Number(o.finalPrice).toFixed(2)
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
