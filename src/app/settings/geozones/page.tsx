"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

// Dynamic import with SSR disabled for Leaflet dependency
const GeozoneMapClient = dynamic(
  () => import("@/components/settings/GeozoneMapClient"),
  { 
    ssr: false, 
    loading: () => (
      <div style={{ padding: 20, textAlign: "center", color: "var(--color-text-3)", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Загрузка карты (Leaflet + Geoman)...
      </div>
    ) 
  }
);

interface Geozone {
  id: number;
  name: string;
  type: string;
  polygon: string; // WKT
}

export default function GeozonesPage() {
  const [zones, setZones] = useState<Geozone[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchZones = async () => {
    try {
      const res = await fetch("/api/geozones");
      if (res.ok) setZones(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZones();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить геозону?")) return;
    try {
      const res = await fetch(`/api/geozones/${id}`, { method: "DELETE" });
      if (res.ok) {
        setZones(zones.filter(z => z.id !== id));
      } else {
        const error = await res.json();
        alert(error.error || "Ошибка удаления");
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка удаления");
    }
  };

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", backgroundColor: "var(--color-bg)", borderLeft: "1px solid var(--color-border)" }}>
      {/* Left panel: List */}
      <div style={{ width: "350px", borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Геозоны</h2>
            <div style={{ fontSize: "0.8rem", color: "var(--color-text-3)" }}>
              Используются для тарифов и статусов
            </div>
          </div>
          <span className="badge" style={{ backgroundColor: "var(--color-primary-dark)", color: "white" }}>{zones.length}</span>
        </div>
        
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "var(--color-text-3)" }}>Загрузка...</div>
          ) : zones.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--color-text-3)" }}>
              Нет сохраненных зон.<br/>
              Нарисуйте полигон на карте справа и сохраните.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {zones.map((z) => (
                <div key={z.id} style={{ 
                  backgroundColor: "var(--color-surface)", 
                  padding: "12px", 
                  borderRadius: "6px", 
                  border: "1px solid var(--color-border)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{z.name}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--color-text-3)" }}>{z.type}</div>
                  </div>
                  <button 
                    className="btn btn-ghost btn-sm" 
                    onClick={() => handleDelete(z.id)}
                    style={{ color: "#e84646", padding: "4px 8px" }}
                    title="Удалить"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Editor */}
      <div style={{ flex: 1, position: "relative" }}>
        <GeozoneMapClient 
          savedZones={zones} 
          onSaveSuccess={() => fetchZones()} 
        />
      </div>
    </div>
  );
}
