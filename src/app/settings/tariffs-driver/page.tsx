"use client";

import { useState, useEffect } from "react";

export default function TariffsDriverPage() {
  const [tariffs, setTariffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const loadTariffs = async () => {
    try {
      const res = await fetch("/api/tariff-groups");
      const data = await res.json();
      if (data.data) {
        setTariffs(data.data.filter((t: any) => t.type === "commission"));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTariffs();
  }, []);

  const handleSave = async () => {
    if (!name || !value) {
      alert("Заполните название и комиссию");
      return;
    }
    
    setLoading(true);
    try {
      const method = editId ? "PUT" : "POST";
      const url = editId ? `/api/tariff-groups/${editId}` : "/api/tariff-groups";
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value: Number(value), type: "commission" })
      });
      
      if (res.ok) {
        setEditId(null);
        setName("");
        setValue("");
        await loadTariffs();
      } else {
        const err = await res.json();
        alert(err.error || "Ошибка сохранения");
      }
    } catch (e) {
      alert("Ошибка сети");
    }
    setLoading(false);
  };

  const handleEdit = (t: any) => {
    setEditId(t.id);
    setName(t.name);
    setValue(String(t.value));
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить этот тариф? (Водители с этим тарифом будут сброшены на стандарт)")) return;
    
    setLoading(true);
    try {
      await fetch(`/api/tariff-groups/${id}`, { method: "DELETE" });
      await loadTariffs();
    } catch (e) {
      alert("Ошибка удаления");
    }
    setLoading(false);
  };

  const cancelEdit = () => {
    setEditId(null);
    setName("");
    setValue("");
  }

  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", backgroundColor: "var(--color-bg)", height: "100%" }}>
      <h2>Тарифы для водителей (Комиссии)</h2>

      <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", gap: 32 }}>
        
        {/* List side */}
        <div style={{ flex: 2 }}>
          <div className="data-table-wrap" style={{ border: "1px solid var(--color-border-2)", borderRadius: 8, overflow: "hidden" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 60, textAlign: "center" }}>ID</th>
                  <th>Название тарифа</th>
                  <th style={{ textAlign: "center" }}>Комиссия (%)</th>
                  <th style={{ width: 100, textAlign: "center" }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {loading && tariffs.length === 0 ? (
                  <tr><td colSpan={4} align="center">Загрузка...</td></tr>
                ) : (
                  tariffs.map((t) => (
                    <tr key={t.id}>
                      <td className="text-muted text-sm" style={{ textAlign: "center" }}>{t.id}</td>
                      <td style={{ fontWeight: 500 }}>{t.name}</td>
                      <td style={{ textAlign: "center" }}>
                        <span style={{ 
                          background: "#e6fcf5", color: "#0ca678", 
                          padding: "4px 8px", borderRadius: 6, fontWeight: 600, fontSize: 13 
                        }}>
                          {t.value}%
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div className="flex-row" style={{ justifyContent: "center" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleEdit(t)} title="Редактировать">✏</button>
                          <button className="btn btn-ghost btn-sm text-danger" onClick={() => handleDelete(t.id)} title="Удалить">🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Form side */}
        <div style={{ flex: 1 }}>
          <div style={{ background: "var(--color-surface)", padding: 20, border: "1px solid var(--color-border-2)", borderRadius: 6 }}>
            <h4 style={{ margin: "0 0 16px", fontSize: 15 }}>{editId ? "Редактировать тариф" : "Добавить тариф"}</h4>
            
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: 13, color: "var(--color-text-3)" }}>Название</label>
              <input 
                type="text" 
                className="form-input" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                placeholder="Например: VIP" 
              />
            </div>
            
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 4, fontSize: 13, color: "var(--color-text-3)" }}>Комиссия с заказа (%)</label>
              <input 
                type="number" 
                className="form-input" 
                value={value} 
                onChange={e => setValue(e.target.value)} 
                placeholder="15" 
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={loading} style={{ flex: 1 }}>
                {editId ? "Обновить" : "Добавить"}
              </button>
              {editId && (
                <button className="btn btn-ghost" onClick={cancelEdit} disabled={loading}>
                  Отмена
                </button>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
