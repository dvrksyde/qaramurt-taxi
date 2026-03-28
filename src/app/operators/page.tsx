"use client";
import { useEffect, useState } from "react";
import type { Operator } from "@/types";

export default function OperatorsPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/operators")
      .then((r) => r.json())
      .then((d) => d.data && setOperators(d.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-content">
      <div className="action-bar">
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Операторы</h2>
        <div style={{ marginLeft: "auto" }}>
          <button className="btn btn-primary" id="btn-add-operator">+ Добавить оператора</button>
        </div>
      </div>

      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Логин</th>
                <th>ФИО</th>
                <th>Роль</th>
                <th>Касса</th>
                <th>Аванс (ПО)</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((op) => (
                <tr key={op.id}>
                  <td className="text-muted text-sm">{op.id}</td>
                  <td className="text-mono">{op.login}</td>
                  <td style={{ fontWeight: 600 }}>{op.name}</td>
                  <td>
                    <span className={`status-badge ${op.role === "admin" ? "assigned" : "completed"}`}>
                      {op.role === "admin" ? "Администратор" : "Оператор"}
                    </span>
                  </td>
                  <td className="text-mono">{Number(op.cashBalance).toFixed(2)} ₽</td>
                  <td className="text-mono">{Number(op.advanceBalance).toFixed(2)} ₽</td>
                  <td>
                    <span className={`status-badge ${op.isActive ? "in_progress" : "canceled"}`}>
                      {op.isActive ? "Активен" : "Отключён"}
                    </span>
                  </td>
                  <td>
                    <div className="flex-row">
                      <button className="btn btn-ghost btn-sm">✏️</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--status-offline)" }}>✕</button>
                    </div>
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
