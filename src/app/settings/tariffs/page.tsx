"use client";

import { useState, useEffect, useCallback } from "react";

interface Tariff {
  id: number;
  name: string;
  serviceId: number;
  classId: number;
  basePrice: number;
  pricePerKm: number;
  outOfCityKmRate: number;
  pricePerMin: number;
  minPrice: number;
  freeWaitMinutes: number;
  extraWaitPrice: number;
  isActive: boolean;
  service?: { id: number; name: string };
  class?: { id: number; name: string };
}

interface EditState {
  pricePerKm: string;
  outOfCityKmRate: string;
  basePrice: string;
  minPrice: string;
  freeWaitMinutes: string;
}

export default function TariffsPage() {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>({
    pricePerKm: "",
    outOfCityKmRate: "",
    basePrice: "",
    minPrice: "",
    freeWaitMinutes: "",
  });
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tariffs");
      const d = await res.json();
      if (d.data) setTariffs(d.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (t: Tariff) => {
    setEditId(t.id);
    setEditState({
      pricePerKm: String(t.pricePerKm),
      outOfCityKmRate: String(t.outOfCityKmRate),
      basePrice: String(t.basePrice),
      minPrice: String(t.minPrice),
      freeWaitMinutes: String(t.freeWaitMinutes),
    });
  };

  const cancelEdit = () => setEditId(null);

  const save = async (id: number) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tariffs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricePerKm: Number(editState.pricePerKm),
          outOfCityKmRate: Number(editState.outOfCityKmRate),
          basePrice: Number(editState.basePrice),
          minPrice: Number(editState.minPrice),
          freeWaitMinutes: Number(editState.freeWaitMinutes),
          // Pass through unchanged fields
          pricePerMin: tariffs.find((t) => t.id === id)?.pricePerMin ?? 0,
          extraWaitPrice: tariffs.find((t) => t.id === id)?.extraWaitPrice ?? 0,
        }),
      });
      if (res.ok) {
        setEditId(null);
        setSavedId(id);
        setTimeout(() => setSavedId(null), 2000);
        await load();
      } else {
        const err = await res.json();
        alert(err.error || "Ошибка сохранения");
      }
    } catch {
      alert("Ошибка сети");
    } finally {
      setSaving(false);
    }
  };

  // Group tariffs by service
  const grouped = tariffs.reduce<Record<string, Tariff[]>>((acc, t) => {
    const key = t.service?.name ?? `Услуга ${t.serviceId}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 1100 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Тарифы маршрутов</h2>
        <p style={{ margin: "6px 0 0", color: "var(--color-text-3)", fontSize: 13 }}>
          Настройте ставки за км для поездок внутри города и за городом.
          Загородная ставка применяется автоматически при пересечении границы города.
        </p>
      </div>

      {/* Info banner */}
      <div style={{
        padding: "12px 16px", borderRadius: 10,
        background: "rgba(230,126,34,0.08)",
        border: "1px solid rgba(230,126,34,0.3)",
        fontSize: 13, color: "var(--color-text-2)",
        display: "flex", gap: 10, alignItems: "flex-start",
      }}>
        <span style={{ fontSize: 18 }}>🏙</span>
        <div>
          <strong>Как работает загородный тариф:</strong> когда водитель пересекает границу города (нарисованную на карте в Мониторе),
          система автоматически переключается на загородную ставку + 25 ₸/мин. При возврате в город — обратно на городскую ставку.
          Итоговая стоимость = городские км × городская ставка + загородные км × загородная ставка + загородное время × 25.
        </div>
      </div>

      {loading ? (
        <div style={{ color: "var(--color-text-3)", padding: 20 }}>Загрузка...</div>
      ) : (
        Object.entries(grouped).map(([serviceName, items]) => (
          <div key={serviceName}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--color-text-2)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              {serviceName}
            </div>
            <div className="data-table-wrap" style={{ border: "1px solid var(--color-border-2)", borderRadius: 8, overflow: "hidden" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Тариф / Класс</th>
                    <th style={{ textAlign: "center" }}>Базовая ставка</th>
                    <th style={{ textAlign: "center", color: "#3db84a" }}>🏙 В городе (₸/км)</th>
                    <th style={{ textAlign: "center", color: "#e67e22" }}>🚗 За городом (₸/км)</th>
                    <th style={{ textAlign: "center" }}>Мин. цена</th>
                    <th style={{ textAlign: "center" }}>Беспл. ожидание</th>
                    <th style={{ width: 100, textAlign: "center" }}>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => {
                    const isEditing = editId === t.id;
                    const isSaved = savedId === t.id;

                    return (
                      <tr key={t.id} style={{ background: isEditing ? "rgba(var(--color-primary-rgb,9,132,227),0.04)" : undefined }}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{t.name}</div>
                          <div style={{ fontSize: 11, color: "var(--color-text-3)", marginTop: 2 }}>
                            Класс: {t.class?.name ?? `#${t.classId}`}
                          </div>
                        </td>

                        <td style={{ textAlign: "center" }}>
                          {isEditing ? (
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: 80, textAlign: "center", padding: "4px 8px" }}
                              value={editState.basePrice}
                              onChange={(e) => setEditState((s) => ({ ...s, basePrice: e.target.value }))}
                            />
                          ) : (
                            <span style={{ fontWeight: 600 }}>{t.basePrice} ₸</span>
                          )}
                        </td>

                        <td style={{ textAlign: "center" }}>
                          {isEditing ? (
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: 80, textAlign: "center", padding: "4px 8px", borderColor: "#3db84a" }}
                              value={editState.pricePerKm}
                              onChange={(e) => setEditState((s) => ({ ...s, pricePerKm: e.target.value }))}
                            />
                          ) : (
                            <span style={{ fontWeight: 700, color: "#3db84a" }}>{t.pricePerKm} ₸/км</span>
                          )}
                        </td>

                        <td style={{ textAlign: "center" }}>
                          {isEditing ? (
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: 80, textAlign: "center", padding: "4px 8px", borderColor: "#e67e22" }}
                              value={editState.outOfCityKmRate}
                              onChange={(e) => setEditState((s) => ({ ...s, outOfCityKmRate: e.target.value }))}
                            />
                          ) : t.outOfCityKmRate > 0 ? (
                            <span style={{ fontWeight: 700, color: "#e67e22" }}>{t.outOfCityKmRate} ₸/км</span>
                          ) : (
                            <span style={{ color: "var(--color-text-3)", fontSize: 12 }}>Не задано</span>
                          )}
                        </td>

                        <td style={{ textAlign: "center" }}>
                          {isEditing ? (
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: 80, textAlign: "center", padding: "4px 8px" }}
                              value={editState.minPrice}
                              onChange={(e) => setEditState((s) => ({ ...s, minPrice: e.target.value }))}
                            />
                          ) : (
                            <span>{t.minPrice} ₸</span>
                          )}
                        </td>

                        <td style={{ textAlign: "center" }}>
                          {isEditing ? (
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: 60, textAlign: "center", padding: "4px 8px" }}
                              value={editState.freeWaitMinutes}
                              onChange={(e) => setEditState((s) => ({ ...s, freeWaitMinutes: e.target.value }))}
                            />
                          ) : (
                            <span>{t.freeWaitMinutes} мин</span>
                          )}
                        </td>

                        <td style={{ textAlign: "center" }}>
                          {isSaved ? (
                            <span style={{ color: "#3db84a", fontSize: 13, fontWeight: 700 }}>✓ Сохранено</span>
                          ) : isEditing ? (
                            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => save(t.id)}
                                disabled={saving}
                              >
                                {saving ? "..." : "✓"}
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>✕</button>
                            </div>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => startEdit(t)} title="Редактировать">
                              ✏
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {!loading && tariffs.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--color-text-3)" }}>
          Тарифы не найдены. Запустите сид базы данных: <code>npm run db:seed</code>
        </div>
      )}
    </div>
  );
}
