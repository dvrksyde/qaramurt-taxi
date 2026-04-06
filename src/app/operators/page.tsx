"use client";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import type { Operator } from "@/types";
import { OperatorModal } from "@/components/operators/OperatorModal";
import { SettlementModal } from "@/components/operators/SettlementModal";

export default function OperatorsPage() {
  const { data: session } = useSession();
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettlementOpen, setIsSettlementOpen] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null);

  const user = session?.user as any;
  const isAdmin = user?.role === "admin";

  const fetchOperators = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    fetch("/api/operators")
      .then((r) => r.json())
      .then((d) => d.data && setOperators(d.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchOperators();
    // Start heartbeat to keep current user online
    const heartbeat = () => fetch("/api/operators/heartbeat", { method: "POST" }).catch(() => {});
    heartbeat();
    const interval = setInterval(heartbeat, 60_000); // every 60 seconds
    return () => clearInterval(interval);
  }, [fetchOperators]);

  // Re-fetch every 30s to refresh online statuses
  useEffect(() => {
    const interval = setInterval(() => fetchOperators(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchOperators]);

  const handleToggle = async (id: number, isActive: boolean) => {
    if (!confirm(`Вы уверены, что хотите ${isActive ? "включить" : "заблокировать"} этого оператора?`)) return;
    try {
      const res = await fetch(`/api/operators/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive })
      });
      if (res.ok) fetchOperators();
      else alert("Ошибка изменения статуса");
    } catch {
      alert("Ошибка сети");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Вы уверены, что хотите НАВСЕГДА удалить этого оператора из базы данных?")) return;
    try {
      const res = await fetch(`/api/operators/${id}`, { method: "DELETE" });
      if (res.ok) fetchOperators();
      else {
        const d = await res.json();
        alert(d.error || "Ошибка удаления");
      }
    } catch {
      alert("Ошибка сети");
    }
  };

  return (
    <div className="page-content">
      <div className="action-bar">
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Операторы</h2>
        {isAdmin && (
          <div style={{ marginLeft: "auto" }}>
            <button
              className="btn btn-primary"
              id="btn-add-operator"
              onClick={() => { setSelectedOperator(null); setIsModalOpen(true); }}
            >
              + Добавить оператора
            </button>
          </div>
        )}
      </div>

      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 30, textAlign: "center" }}></th>
                 <th style={{ width: 220 }}>Логин</th>
                 <th style={{ width: "100%", paddingLeft: 30 }}>Имя</th>
                 <th style={{ paddingLeft: 40, whiteSpace: "nowrap" }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((op) => (
                <tr key={op.id}>
                  <td style={{ textAlign: "center" }}>
                    <span
                      className={`status-dot ${op.isOnline ? "free" : "offline"}`}
                      title={op.isOnline ? "В сети" : "Не в сети"}
                    />
                  </td>
                   <td className="text-mono">{op.login}</td>
                  <td style={{ fontWeight: 500, paddingLeft: 30 }}>{op.name}</td>
                  <td style={{ paddingLeft: 40, whiteSpace: "nowrap" }}>
                    {isAdmin ? (
                      <span className="op-actions">
                        <button
                          className="op-action-link"
                          onClick={() => { setSelectedOperator(op); setIsSettlementOpen(true); }}
                        >
                          Расчёты
                        </button>
                        <span className="op-action-sep">·</span>
                        <button
                          className="op-action-link"
                          onClick={() => { setSelectedOperator(op); setIsModalOpen(true); }}
                        >
                          Редактировать
                        </button>
                        <span className="op-action-sep">·</span>
                        <button
                          className="op-action-link"
                          onClick={() => handleToggle(op.id, !op.isActive)}
                        >
                          {op.isActive ? "Заблокировать" : "Разблокировать"}
                        </button>
                        <span className="op-action-sep">·</span>
                        <button
                          className="op-action-link op-action-danger"
                          onClick={() => handleDelete(op.id)}
                        >
                          Удалить
                        </button>
                      </span>
                    ) : (
                      <span className="text-muted text-sm">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isModalOpen && isAdmin && (
        <OperatorModal
          operator={selectedOperator}
          onClose={() => setIsModalOpen(false)}
          onSuccess={fetchOperators}
        />
      )}

      {isSettlementOpen && selectedOperator && isAdmin && (
        <SettlementModal
          operator={selectedOperator}
          onClose={() => setIsSettlementOpen(false)}
        />
      )}
    </div>
  );
}
