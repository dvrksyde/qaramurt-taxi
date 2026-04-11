"use client";
import React, { useState, useEffect, useCallback } from "react";
import type { Operator } from "@/types";

interface Settlement {
  id: number;
  amount: number;
  type: string;
  description: string | null;
  createdAt: string;
}

interface Props {
  operator: Operator;
  onClose: () => void;
}

export function SettlementModal({ operator, onClose }: Props) {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const fetchSettlements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/operators/${operator.id}/settlements`);
      const d = await res.json();
      if (d.data) setSettlements(d.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [operator.id]);

  useEffect(() => {
    fetchSettlements();
  }, [fetchSettlements]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return alert("Введите корректную сумму");

    setSubmitting(true);
    try {
      const res = await fetch(`/api/operators/${operator.id}/settlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          type: "salary",
          description
        }),
      });

      if (res.ok) {
        setAmount("");
        setDescription("");
        fetchSettlements();
      } else {
        const d = await res.json();
        alert(d.error || "Ошибка сохранения");
      }
    } catch (e) {
      alert("Ошибка сети");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 650 }}>
        <div className="modal-header">
          Расчёты: {operator.name}
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 240px" }}>
            
            {/* History Table */}
            <div style={{ borderRight: "1px solid #eee", maxHeight: 400, overflowY: "auto", padding: 20 }}>
              <h4 style={{ margin: "0 0 16px 0", fontSize: 13, textTransform: "uppercase", color: "#888" }}>История выплат</h4>
              {loading ? (
                <div className="pulse">Загрузка...</div>
              ) : settlements.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#aaa" }}>Нет записей</div>
              ) : (
                <table className="data-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th style={{ textAlign: "right" }}>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.map(s => (
                      <tr key={s.id}>
                        <td>{new Date(s.createdAt).toLocaleDateString("ru-RU")}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{Number(s.amount).toLocaleString()} ₸</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Form */}
            <div style={{ padding: 20, background: "#f9f9fb" }}>
              <h4 style={{ margin: "0 0 16px 0", fontSize: 13, textTransform: "uppercase", color: "#888" }}>Новая выплата</h4>
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 12 }}>Сумма (₸)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={amount} 
                    onChange={e => setAmount(e.target.value)}
                    placeholder="Напр. 50000"
                    required 
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: 12 }}>Описание</label>
                  <textarea 
                    className="form-input" 
                    style={{ height: 60, resize: "none" }}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Месяц, премия и т.д."
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={submitting || !amount}>
                  {submitting ? "..." : "Внести выплату"}
                </button>
              </form>
            </div>

          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
