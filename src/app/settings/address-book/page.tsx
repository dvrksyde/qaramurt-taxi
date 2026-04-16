"use client";
import { useEffect, useState, useCallback, useRef } from "react";

interface AddressEntry {
  id: number;
  name: string;
  fullName: string | null;
  latitude: string;
  longitude: string;
  isActive: boolean;
  createdAt: string;
}

const EMPTY_FORM = { name: "", fullName: "", latitude: "", longitude: "" };

export default function AddressBookPage() {
  const [items, setItems] = useState<AddressEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [pickingOnMap, setPickingOnMap] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (search = q) => {
    setLoading(true);
    const res = await fetch(`/api/address-book/manage?q=${encodeURIComponent(search)}&take=100`);
    const d = await res.json();
    if (d.data) { setItems(d.data); setTotal(d.total); }
    setLoading(false);
  }, [q]);

  useEffect(() => { load(); }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const openEdit = (item: AddressEntry) => {
    setEditId(item.id);
    setForm({
      name: item.name,
      fullName: item.fullName || "",
      latitude: item.latitude,
      longitude: item.longitude,
    });
    setError("");
    setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.latitude || !form.longitude) {
      setError("Заполните Название, Широту и Долготу");
      return;
    }
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError("Неверные координаты");
      return;
    }

    setSaving(true);
    setError("");
    const url = editId ? `/api/address-book/manage/${editId}` : "/api/address-book/manage";
    const method = editId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        fullName: form.fullName.trim() || null,
        latitude: lat,
        longitude: lng,
      }),
    });
    const d = await res.json();
    setSaving(false);

    if (!res.ok) { setError(d.error || "Ошибка сохранения"); return; }
    setShowForm(false);
    load();
  };

  const handleToggle = async (item: AddressEntry) => {
    await fetch(`/api/address-book/manage/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !item.isActive }),
    });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить этот адрес?")) return;
    await fetch(`/api/address-book/manage/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="page-content">

      {/* Header */}
      <div style={{ padding: "10px 14px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <strong>📍 Адресная книга</strong>
          <span style={{ fontSize: 12, color: "var(--color-text-3)" }}>Всего: {total}</span>
          <input
            type="text"
            placeholder="Поиск..."
            value={q}
            onChange={e => setQ(e.target.value)}
            className="form-input"
            style={{ width: 200, height: 28, fontSize: 12 }}
          />
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Добавить адрес</button>
      </div>

      {/* Table */}
      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📍</div>
            <div>Адреса не найдены</div>
            <button className="btn btn-primary btn-sm" onClick={openAdd}>Добавить</button>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>ID</th>
                <th>Название (народное)</th>
                <th>Полный адрес</th>
                <th style={{ textAlign: "center" }}>Широта</th>
                <th style={{ textAlign: "center" }}>Долгота</th>
                <th style={{ textAlign: "center" }}>Активен</th>
                <th style={{ textAlign: "center", width: 100 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} style={{ opacity: item.isActive ? 1 : 0.5 }}>
                  <td className="text-muted text-sm">{item.id}</td>
                  <td style={{ fontWeight: 600 }}>{item.name}</td>
                  <td className="text-muted text-sm">{item.fullName || <span style={{ color: "#ccc" }}>—</span>}</td>
                  <td className="text-muted text-sm" style={{ textAlign: "center", fontFamily: "monospace" }}>{Number(item.latitude).toFixed(5)}</td>
                  <td className="text-muted text-sm" style={{ textAlign: "center", fontFamily: "monospace" }}>{Number(item.longitude).toFixed(5)}</td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      className={`btn btn-sm ${item.isActive ? "btn-ghost" : "btn-ghost"}`}
                      style={{ color: item.isActive ? "#2ecc71" : "#aaa", fontWeight: 700 }}
                      onClick={() => handleToggle(item)}
                    >
                      {item.isActive ? "✓ Да" : "Нет"}
                    </button>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <div className="flex-row" style={{ justifyContent: "center" }}>
                      <button className="btn btn-ghost btn-sm" title="Редактировать" onClick={() => openEdit(item)}>✏️</button>
                      <button className="btn btn-ghost btn-sm text-danger" title="Удалить" onClick={() => handleDelete(item.id)}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal" style={{ width: 480, maxWidth: "96vw" }}>
            <div className="modal-header">
              {editId ? "Редактировать адрес" : "Добавить адрес"}
              <button className="modal-close" onClick={() => setShowForm(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-row" style={{ marginBottom: 12 }}>
                <span className="form-label" style={{ minWidth: 120 }}>Название:</span>
                <input
                  ref={nameRef}
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Например: Рынок, Школа №3"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <span className="form-label" style={{ minWidth: 120 }}>Полный адрес:</span>
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Карамурт, ул. Ленина, 1"
                  value={form.fullName}
                  onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                />
              </div>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <span className="form-label" style={{ minWidth: 120 }}>Широта:</span>
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="42.12345"
                  value={form.latitude}
                  onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                />
              </div>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <span className="form-label" style={{ minWidth: 120 }}>Долгота:</span>
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="69.12345"
                  value={form.longitude}
                  onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                />
              </div>

              <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#0369a1", marginBottom: 8 }}>
                💡 <strong>Совет:</strong> Координаты можно взять из Яндекс.Карт или Google Maps — правой кнопкой на точке → «Что здесь?»
              </div>

              {error && <div style={{ color: "#e03131", fontSize: 12, marginBottom: 8 }}>⚠️ {error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
                {saving ? "Сохранение..." : (editId ? "Сохранить" : "Добавить")}
              </button>
              <button className="btn btn-ghost btn-lg" onClick={() => setShowForm(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
