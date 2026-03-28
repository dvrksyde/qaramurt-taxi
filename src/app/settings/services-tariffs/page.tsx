"use client";
import { useState, useEffect } from "react";

interface TaxiService {
  id: number;
  name: string;
  settlement: string;
  priority: number;
  autoSelectionType: string;
  isActive: boolean;
}

interface Tariff {
  id: number;
  serviceId: number;
  classId: number;
  name: string;
  basePrice: number;
  pricePerKm: number;
  pricePerMin: number;
  minPrice: number;
  freeWaitMinutes: number;
  extraWaitPrice: number;
  class?: { name: string; icon: string };
}

export default function ServicesTariffsPage() {
  const [services, setServices] = useState<TaxiService[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);

  // For inline editing
  const [editingTariffId, setEditingTariffId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Tariff>>({});

  useEffect(() => {
    Promise.all([
      fetch("/api/services").then(res => res.json()),
      fetch("/api/tariffs").then(res => res.json())
    ]).then(([svcsRes, trfRes]) => {
      if (svcsRes.data) setServices(svcsRes.data);
      if (trfRes.data) setTariffs(trfRes.data);
    }).finally(() => setLoading(false));
  }, []);

  const handleEdit = (t: Tariff) => {
    setEditingTariffId(t.id);
    setEditForm({
      basePrice: t.basePrice,
      pricePerKm: t.pricePerKm,
      pricePerMin: t.pricePerMin,
      minPrice: t.minPrice,
      freeWaitMinutes: t.freeWaitMinutes,
      extraWaitPrice: t.extraWaitPrice
    });
  };

  const handleSave = async (id: number) => {
    try {
      const res = await fetch(`/api/tariffs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm)
      });
      if (res.ok) {
        const updated = await res.json();
        setTariffs(prev => prev.map(t => t.id === id ? { ...t, ...editForm } as Tariff : t));
        setEditingTariffId(null);
      } else {
        alert("Ошибка при сохранении");
      }
    } catch (e) {
      alert("Ошибка сети");
    }
  };

  if (loading) return <div style={{ padding: "20px", color: "var(--color-text-3)" }}>Загрузка...</div>;

  return (
    <div style={{ padding: "20px", overflowY: "auto", height: "100%", width: "100%", backgroundColor: "var(--color-bg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2>Службы такси и тарифы</h2>
        <button className="btn btn-primary btn-sm">+ Добавить службу</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {services.map(svc => {
          const svcTariffs = tariffs.filter(t => t.serviceId === svc.id);

          return (
            <div key={svc.id} className="card" style={{ padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px", borderBottom: "1px solid var(--color-border)", paddingBottom: "12px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.2rem", color: "var(--color-primary)" }}>{svc.name}</h3>
                  <div style={{ fontSize: "0.85rem", color: "var(--color-text-3)", marginTop: "4px" }}>
                    {svc.settlement} | Распределение: {svc.autoSelectionType === "nearest" ? "Ближайший" : "По очереди"}
                  </div>
                </div>
                <div>
                  <button className="btn btn-ghost btn-sm">Редактировать службу</button>
                </div>
              </div>

              {/* Tariffs Table */}
              <table className="data-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Класс</th>
                    <th>Название тарифа</th>
                    <th>Посадка (мин. цена)</th>
                    <th>Цена за КМ</th>
                    <th>Цена за МИН (в пути)</th>
                    <th>Беспл. ожидание / Платное</th>
                    <th style={{ width: "120px" }}>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {svcTariffs.map(t => {
                    const isEditing = editingTariffId === t.id;
                    return (
                      <tr key={t.id}>
                        <td>{t.class?.name || `ID:${t.classId}`}</td>
                        <td>{t.name}</td>
                        
                        {isEditing ? (
                          <>
                            <td>
                              <input type="number" className="form-input" style={{ width: "60px", padding: "4px" }}
                                value={editForm.basePrice ?? ""} onChange={e => setEditForm({...editForm, basePrice: Number(e.target.value)})} />
                              {' / '}
                              <input type="number" className="form-input" style={{ width: "60px", padding: "4px" }}
                                value={editForm.minPrice ?? ""} onChange={e => setEditForm({...editForm, minPrice: Number(e.target.value)})} />
                            </td>
                            <td>
                              <input type="number" className="form-input" style={{ width: "60px", padding: "4px" }}
                                value={editForm.pricePerKm ?? ""} onChange={e => setEditForm({...editForm, pricePerKm: Number(e.target.value)})} />
                            </td>
                            <td>
                              <input type="number" className="form-input" style={{ width: "60px", padding: "4px" }}
                                value={editForm.pricePerMin ?? ""} onChange={e => setEditForm({...editForm, pricePerMin: Number(e.target.value)})} />
                            </td>
                            <td>
                              <input type="number" className="form-input" style={{ width: "40px", padding: "4px" }}
                                value={editForm.freeWaitMinutes ?? ""} onChange={e => setEditForm({...editForm, freeWaitMinutes: Number(e.target.value)})} />
                              {' мин / '}
                              <input type="number" className="form-input" style={{ width: "40px", padding: "4px" }}
                                value={editForm.extraWaitPrice ?? ""} onChange={e => setEditForm({...editForm, extraWaitPrice: Number(e.target.value)})} /> ₽/м
                            </td>
                            <td>
                              <button className="btn btn-primary btn-sm" onClick={() => handleSave(t.id)}>Сохр.</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditingTariffId(null)}>Отм.</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>{t.basePrice} ₽ / min. {t.minPrice} ₽</td>
                            <td>{t.pricePerKm} ₽/км</td>
                            <td>{t.pricePerMin} ₽/мин</td>
                            <td>{t.freeWaitMinutes} мин / {t.extraWaitPrice} ₽/мин</td>
                            <td>
                              <button className="btn btn-ghost btn-sm" onClick={() => handleEdit(t)}>Изменить</button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                  {svcTariffs.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--color-text-3)" }}>Нет тарифов для этой службы</td></tr>
                  )}
                </tbody>
              </table>
              <div style={{ marginTop: "12px", textAlign: "right" }}>
                 <button className="btn btn-ghost btn-sm" style={{ color: "var(--color-primary)" }}>+ Добавить класс/тариф</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
