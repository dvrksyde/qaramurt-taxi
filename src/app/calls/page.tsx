"use client";
import { useEffect, useState } from "react";
import type { CallLog } from "@/types";

export default function CallsPage() {
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const now = new Date();
  const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const [fromDate, setFromDate] = useState(monthAgo.toISOString().split("T")[0] + " 00:00");
  const [toDate,   setToDate]   = useState(now.toISOString().split("T")[0] + " 23:59");
  const [phone,    setPhone]    = useState("");
  const [callType, setCallType] = useState("");
  const [status,   setStatus]   = useState("");

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set("fromDate", new Date(fromDate).toISOString());
    if (toDate)   params.set("toDate",   new Date(toDate).toISOString());
    if (phone)    params.set("phone",    phone);
    if (callType) params.set("callType", callType);
    if (status)   params.set("status",   status);

    fetch(`/api/calls?${params}`)
      .then((r) => r.json())
      .then((d) => d.data && setCalls(d.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const formatSec = (sec: number) => {
    if (!sec) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}м ${s}с` : `${s}с`;
  };

  const STATUS_COLORS: Record<string, string> = {
    answered: "var(--status-free)",
    missed:   "var(--status-offline)",
    busy:     "var(--status-busy)",
    failed:   "var(--status-offline)",
  };
  const STATUS_LABELS: Record<string, string> = {
    answered: "Ответил", missed: "Пропущен", busy: "Занято", failed: "Ошибка",
  };

  return (
    <div className="page-content">
      {/* Filter bar — matches analysis: 6 filter dimensions */}
      <div className="action-bar" style={{ flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 12 }}>Период с</span>
        <input type="datetime-local" className="form-input" style={{ width: 160 }} value={fromDate}
          onChange={(e) => setFromDate(e.target.value)} id="calls-from" />
        <span style={{ fontSize: 12 }}>по</span>
        <input type="datetime-local" className="form-input" style={{ width: 160 }} value={toDate}
          onChange={(e) => setToDate(e.target.value)} id="calls-to" />

        <span style={{ fontSize: 12, marginLeft: 8 }}>Телефон:</span>
        <input className="form-input" style={{ width: 120 }} value={phone}
          onChange={(e) => setPhone(e.target.value)} placeholder="+7..." id="calls-phone" />

        <span style={{ fontSize: 12 }}>Тип звонка:</span>
        <select className="form-select" style={{ width: 110 }} value={callType}
          onChange={(e) => setCallType(e.target.value)} id="calls-type">
          <option value="">Любой</option>
          <option value="inbound">Входящий</option>
          <option value="outbound">Исходящий</option>
        </select>

        <span style={{ fontSize: 12 }}>Ответил:</span>
        <select className="form-select" style={{ width: 100 }} id="calls-answered">
          <option>Любой</option>
        </select>

        <span style={{ fontSize: 12 }}>Статус:</span>
        <select className="form-select" style={{ width: 120 }} value={status}
          onChange={(e) => setStatus(e.target.value)} id="calls-status">
          <option value="">Любой</option>
          <option value="answered">Ответил</option>
          <option value="missed">Пропущен</option>
          <option value="busy">Занято</option>
        </select>

        <span style={{ fontSize: 12 }}>Служба:</span>
        <select className="form-select" style={{ width: 130 }} id="calls-service">
          <option value=""></option>
        </select>

        <button className="btn btn-primary" onClick={load}>🔄 Обновить</button>
      </div>

      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : calls.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📞</div>
            <div>Звонков за выбранный период нет</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Дата/время</th>
                <th>Тип</th>
                <th>Статус</th>
                <th>Телефон (от)</th>
                <th>Телефон (кому)</th>
                <th>Оператор</th>
                <th>Служба</th>
                <th>Ожидание</th>
                <th>Разговор</th>
                <th>Итого</th>
                <th>Запись</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td className="text-muted nowrap" style={{ fontSize: 11 }}>
                    {new Date(c.timestamp).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="text-sm">
                    <span style={{ color: c.callType === "inbound" ? "var(--status-free)" : "var(--color-primary)" }}>
                      {c.callType === "inbound" ? "⬇ Вход." : "⬆ Исх."}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: STATUS_COLORS[c.status] || "#888", fontWeight: 600, fontSize: 11 }}>
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </td>
                  <td className="text-mono">{c.phoneFrom}</td>
                  <td className="text-mono">{c.phoneTo || "—"}</td>
                  <td className="text-sm">{c.operator?.name || "—"}</td>
                  <td className="text-sm text-muted">—</td>
                  <td className="text-mono text-sm">{formatSec(c.durationWaitSec)}</td>
                  <td className="text-mono text-sm">{formatSec(c.durationTalkSec)}</td>
                  <td className="text-mono text-sm">{formatSec(c.durationTotalSec)}</td>
                  <td>
                    {c.recordingUrl
                      ? <a href={c.recordingUrl} className="btn btn-ghost btn-sm">▶ Запись</a>
                      : <span className="text-muted text-sm">—</span>}
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
