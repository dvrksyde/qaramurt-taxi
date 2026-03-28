"use client";
import { useEffect, useState } from "react";
import type { Vehicle, VehicleClass } from "@/types";

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/vehicles")
      .then((r) => r.json())
      .then((d) => d.data && setVehicles(d.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-content">
      <div className="action-bar">
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Автомобили</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn btn-primary" id="btn-add-vehicle">+ Добавить автомобиль</button>
          <button className="btn btn-ghost">⬇ Экспорт CSV</button>
        </div>
      </div>

      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : vehicles.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚗</div>
            <div>Нет автомобилей</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Гос. номер</th>
                <th>Марка</th>
                <th>Модель</th>
                <th>Цвет</th>
                <th>Год</th>
                <th>Собственность</th>
                <th>Водитель</th>
                <th>Службы такси</th>
                <th>Классы</th>
                <th>Опции</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td className="text-muted text-sm">{v.id}</td>
                  <td className="text-mono" style={{ fontWeight: 700 }}>{v.plate}</td>
                  <td>{v.make}</td>
                  <td>{v.model}</td>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorForName(v.color), border: "1px solid #ccc", flexShrink: 0 }} />
                      {v.color}
                    </span>
                  </td>
                  <td className="text-muted">{v.year || "—"}</td>
                  <td className="text-muted text-sm">
                    {v.ownershipType === "driver" ? "Водителя" : "Компании"}
                  </td>
                  <td>
                    {v.driver
                      ? `${v.driver.lastName} ${v.driver.firstName[0]}.`
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-muted text-sm">—</td>
                  <td className="text-muted text-sm">
                    {(v.classes as VehicleClass[] | undefined)?.map((c) => c.name).join(", ") || "—"}
                  </td>
                  <td className="text-muted text-sm">—</td>
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

function colorForName(name: string): string {
  const map: Record<string, string> = {
    белый: "#f5f5f5", черный: "#222", серый: "#888", серебристый: "#ccc",
    красный: "#e74c3c", синий: "#3498db", зеленый: "#2ecc71",
    желтый: "#f5c518", оранжевый: "#e67e22", коричневый: "#795548",
  };
  return map[name.toLowerCase()] || "#ddd";
}
