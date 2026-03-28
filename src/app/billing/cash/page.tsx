"use client";
import { useEffect, useState } from "react";
import type { KassaRow, Operator } from "@/types";

export default function BillingCashPage() {
  const [rows, setRows] = useState<KassaRow[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [operatorId, setOperatorId] = useState("");

  const today = new Date();
  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000);
  const [fromDate, setFromDate] = useState(threeDaysAgo.toISOString().slice(0, 16).replace("T", " "));
  const [toDate,   setToDate]   = useState(today.toISOString().slice(0, 16).replace("T", " "));
  const [nonZeroOnly, setNonZeroOnly] = useState(true);

  useEffect(() => {
    fetch("/api/operators")
      .then((r) => r.json())
      .then((d) => d.data && setOperators(d.data))
      .catch(console.error);
    load();
  }, []);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate)   params.set("fromDate",   new Date(fromDate).toISOString());
    if (toDate)     params.set("toDate",     new Date(toDate).toISOString());
    if (operatorId) params.set("operatorId", operatorId);

    fetch(`/api/billing/cash?${params}`)
      .then((r) => r.json())
      .then((d) => d.data && setRows(d.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const displayRows = nonZeroOnly
    ? rows.filter((r) => r.payouts !== 0 || r.deposits !== 0 || r.beginOperatorCash !== 0 || r.endOperatorCash !== 0)
    : rows;

  const fmt = (n: number) => n.toFixed(2);

  return (
    <div className="page-content">
      <div className="action-bar" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Касса</h2>

        <div className="flex-row" style={{ flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12 }}>Период с</span>
          <input type="datetime-local" className="form-input" style={{ width: 165 }}
            value={fromDate} onChange={(e) => setFromDate(e.target.value)} id="kassa-from" />
          <span style={{ fontSize: 12 }}>по</span>
          <input type="datetime-local" className="form-input" style={{ width: 165 }}
            value={toDate} onChange={(e) => setToDate(e.target.value)} id="kassa-to" />

          <span style={{ fontSize: 12 }}>Оператор:</span>
          <select className="form-select" style={{ width: 210 }} value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)} id="kassa-operator">
            <option value="">по всем операторам</option>
            {operators.map((op) => (
              <option key={op.id} value={op.id}>{op.name}</option>
            ))}
          </select>

          <label className="flex-row" style={{ cursor: "pointer", fontSize: 12 }}>
            <input
              type="checkbox"
              className="form-checkbox"
              checked={nonZeroOnly}
              onChange={(e) => setNonZeroOnly(e.target.checked)}
              id="kassa-nonzero"
            />
            отображать только строки имеющие не нулевые значения
          </label>

          <button className="btn btn-primary" onClick={load} id="kassa-refresh">🔄 Обновить</button>
        </div>

        <div style={{ fontSize: 12, color: "var(--color-text-2)" }}>
          Всего строк: <strong>{displayRows.length}</strong>
        </div>
      </div>

      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : displayRows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💰</div>
            <div>Нет данных за выбранный период</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th rowSpan={2} style={{ verticalAlign: "middle" }}>Оператор-кассир</th>
                <th colSpan={2} style={{ textAlign: "center", borderBottom: "1px solid var(--color-nav-border)" }}>Начальный остаток</th>
                <th colSpan={2} style={{ textAlign: "center", borderBottom: "1px solid var(--color-nav-border)" }}>Оборот</th>
                <th colSpan={2} style={{ textAlign: "center" }}>Конечный остаток</th>
              </tr>
              <tr>
                <th>Долг такси</th>
                <th>Долг оператора (касса оператора)</th>
                <th>Выплаты</th>
                <th>Пополнения</th>
                <th>Долг такси</th>
                <th>Долг оператора (касса оператора)</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.operatorId}>
                  <td style={{ fontWeight: 600 }}>{row.operatorName}</td>
                  <td className="text-mono">{fmt(row.beginTaxiDebt)}</td>
                  <td className="text-mono">{fmt(row.beginOperatorCash)}</td>
                  <td className="text-mono" style={{ color: row.payouts > 0 ? "var(--status-offline)" : "inherit" }}>
                    {fmt(row.payouts)}
                  </td>
                  <td className="text-mono" style={{ color: row.deposits > 0 ? "var(--status-free)" : "inherit" }}>
                    {fmt(row.deposits)}
                  </td>
                  <td className="text-mono">{fmt(row.endTaxiDebt)}</td>
                  <td className="text-mono" style={{ fontWeight: 700 }}>
                    {fmt(row.endOperatorCash)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding: "6px 10px", borderTop: "1px solid var(--color-border)", fontSize: 11, color: "var(--color-text-3)" }}>
        © Все права защищены · qaramurt-taxi · 2024–2026
      </div>
    </div>
  );
}
