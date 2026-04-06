"use client";
import { useEffect, useState } from "react";
import type { Driver } from "@/types";

interface Props {
  driver: Driver;
  onClose: () => void;
  onUpdate: () => void;
}

export function BalanceModal({ driver, onClose, onUpdate }: Props) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("deposit");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadHistory = async () => {
    try {
      const res = await fetch(`/api/drivers/${driver.id}/transactions`);
      const data = await res.json();
      if (data.data) setHistory(data.data);
    } catch (e) {}
    setLoading(false);
  };

  useEffect(() => {
    loadHistory();
  }, [driver.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/drivers/${driver.id}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          type,
          description
        })
      });
      if (res.ok) {
        setAmount("");
        setDescription("");
        loadHistory();
        onUpdate();
      } else {
        const d = await res.json();
        alert(d.error || "Ошибка транзакции");
      }
    } catch (e) {
      alert("Ошибка сети");
    }
    setSubmitting(false);
  };

  const TYPE_LABELS: Record<string, string> = {
    deposit: "Пополнение (+)",
    penalty: "Штраф (-)",
    bonus: "Бонус (+)",
    order_fee: "Комиссия (-)"
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 680, borderRadius: 12, boxShadow: "0 20px 40px rgba(0,0,0,0.2)" }}>
        <div className="modal-header" style={{ background: "var(--color-primary)", color: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
          Баланс: {driver.lastName} {driver.firstName}
          <button className="modal-close" onClick={onClose} style={{ color: "#fff" }}>×</button>
        </div>

        <div className="modal-body" style={{ padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 32, alignItems: "start" }}>
            {/* Left: Form */}
            <div style={{ background: "#fff", padding: 20, borderRadius: 10, border: "1px solid var(--color-border-2)" }}>
              <h4 style={{ marginBottom: 16, fontSize: 16, fontWeight: 600, color: "var(--color-text)" }}>Новая операция</h4>
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", alignItems: "center", gap: 12 }}>
                  <label style={{ fontSize: 13, color: "#666" }}>Тип:</label>
                  <select 
                    className="form-select" 
                    value={type} 
                    onChange={e => setType(e.target.value)}
                    style={{ height: 38, borderColor: "var(--color-border)", borderRadius: 6 }}
                  >
                    <option value="deposit">Пополнение (Наличные)</option>
                    <option value="penalty">Штраф</option>
                    <option value="bonus">Премия / Бонус</option>
                  </select>
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", alignItems: "center", gap: 12 }}>
                  <label style={{ fontSize: 13, color: "#666" }}>Сумма (₸):</label>
                  <div style={{ position: "relative" }}>
                    <input 
                      type="number" 
                      className="form-input" 
                      value={amount} 
                      onChange={e => setAmount(e.target.value)} 
                      placeholder="0"
                      required
                      style={{ height: 38, paddingLeft: 12, fontSize: 15, fontWeight: 600, borderRadius: 6 }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", alignItems: "start", gap: 12 }}>
                  <label style={{ fontSize: 13, color: "#666", marginTop: 8 }}>Инфо:</label>
                  <textarea 
                    className="form-input" 
                    value={description} 
                    onChange={e => setDescription(e.target.value)} 
                    placeholder="Причина (необязательно)..."
                    rows={2}
                    style={{ borderRadius: 6, padding: 10, minHeight: 60 }}
                  />
                </div>

                <div style={{ paddingLeft: 112, marginTop: 4 }}>
                  <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: "100%", height: 42, fontSize: 14, fontWeight: 600, borderRadius: 6 }}>
                    {submitting ? "Выполняется..." : "Внести в базу"}
                  </button>
                </div>
              </form>
            </div>

            {/* Right: Summary */}
            <div style={{ background: "linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)", padding: 24, borderRadius: 10, border: "1px solid var(--color-border-2)", textAlign: "center" }}>
              <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>Текущий баланс:</div>
              <div style={{ 
                fontSize: 36, 
                fontWeight: 800, 
                color: Number(driver.balance) < 100 ? "var(--status-offline)" : "var(--color-primary)",
                letterSpacing: "-0.5px"
              }}>
                {Number(driver.balance).toLocaleString()} <span style={{ fontSize: 20 }}>₸</span>
              </div>
              <div style={{ 
                fontSize: 12, 
                marginTop: 16, 
                padding: "6px 12px", 
                borderRadius: 20, 
                display: "inline-block",
                background: Number(driver.balance) < 100 ? "#fff0f0" : "#f0fdf4",
                color: Number(driver.balance) < 100 ? "#e03131" : "#099268",
                fontWeight: 600,
                border: "1px solid currentColor"
              }}>
                {Number(driver.balance) < 100 ? "⚠️ Лимит исчерпан (< 100 ₸)" : "✅ Баланс в норме"}
              </div>
            </div>
          </div>

          <hr style={{ margin: "20px 0", border: "0", borderTop: "1px solid var(--color-border)" }} />

          <h4 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600, color: "#444", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>🕒</span> История операций (последние 50)
          </h4>
          <div className="data-table-wrap" style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--color-border-2)", borderRadius: 8 }}>
            <table className="data-table small" style={{ border: "none" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#f1f3f5" }}>
                <tr>
                  <th style={{ background: "transparent", borderBottom: "1px solid var(--color-border-2)" }}>Дата</th>
                  <th style={{ background: "transparent", borderBottom: "1px solid var(--color-border-2)" }}>Тип</th>
                  <th style={{ background: "transparent", borderBottom: "1px solid var(--color-border-2)" }}>Сумма</th>
                  <th style={{ background: "transparent", borderBottom: "1px solid var(--color-border-2)" }}>Диспетчер</th>
                  <th style={{ background: "transparent", borderBottom: "1px solid var(--color-border-2)" }}>Инфо</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", padding: 20 }}>Загрузка...</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: "center", padding: 20, color: "#999" }}>Записей пока нет</td></tr>
                ) : (
                  history.map(tx => {
                    const isPositive = ["deposit", "bonus"].includes(tx.type);
                    return (
                      <tr key={tx.id}>
                        <td style={{ fontSize: 11, color: "#666" }}>
                          {new Date(tx.createdAt).toLocaleDateString()}<br/>
                          <span style={{ color: "#999" }}>{new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                        <td style={{ fontSize: 11, fontWeight: 500 }}>{TYPE_LABELS[tx.type] || tx.type}</td>
                        <td style={{ 
                          fontWeight: 700, 
                          fontSize: 13,
                          color: isPositive ? "#2b8a3e" : "#c92a2a" 
                        }}>
                          {isPositive ? "+" : "−"}{Number(tx.amount).toLocaleString()}
                        </td>
                        <td style={{ fontSize: 11, color: "#444" }}>{tx.operator?.name || "Система"}</td>
                        <td style={{ fontSize: 10, color: "#666", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tx.description || (tx.orderId ? `Заказ #${tx.orderId}` : "")}>
                          {tx.description || (tx.orderId ? `Заказ #${tx.orderId}` : "-")}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
