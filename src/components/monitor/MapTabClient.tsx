"use client";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// @ts-ignore
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { useMonitorStore } from "@/stores/monitorStore";
import { useEffect, useState, useRef, useCallback } from "react";
import type { DriverLocation } from "@/types";

// ─── Icon factory ─────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  free: "#22c55e",
  busy: "#f59e0b",
  offline: "#ef4444",
};

function createDriverIcon(driver: DriverLocation): L.DivIcon {
  const color = STATUS_COLORS[driver.status] ?? "#888";
  const label = driver.callsign ?? driver.plate ?? `#${driver.driverId}`;
  return L.divIcon({
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;">
        <div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px ${color}44,0 2px 6px rgba(0,0,0,0.5);"></div>
        <div style="background:#1a1a1a;color:#fff;font-size:9px;font-weight:800;font-family:monospace;letter-spacing:0.5px;padding:1px 5px;border-radius:3px;border:1.5px solid ${color};white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.5);line-height:1.4;">${label}</div>
      </div>`,
    className: "",
    iconSize: [60, 32],
    iconAnchor: [30, 5],
    popupAnchor: [0, 8],
  });
}

function groupDrivers(drivers: DriverLocation[], gridSize: number) {
  const groups: Map<string, DriverLocation[]> = new Map();
  drivers.forEach((d) => {
    const key = `${Math.round(d.lat / gridSize)}_${Math.round(d.lng / gridSize)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  });
  return groups;
}

function createClusterIcon(count: number): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:36px;height:36px;border-radius:50%;background:#1a1a1a;border:2px solid #FFD000;color:#FFD000;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.5);">${count}</div>`,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
  });
}

// ─── City Boundary Control (must live inside MapContainer) ────────────────────
interface CityZone { id: number; geojson: any }

function CityBoundaryLayer({
  drawingActive,
  cityZone,
  onZoneSaved,
  onDrawEnd,
}: {
  drawingActive: boolean;
  cityZone: CityZone | null;
  onZoneSaved: () => void;
  onDrawEnd: () => void;
}) {
  const map = useMap();
  const polygonLayerRef = useRef<L.GeoJSON | null>(null);

  // Display existing city boundary
  useEffect(() => {
    if (polygonLayerRef.current) {
      polygonLayerRef.current.remove();
      polygonLayerRef.current = null;
    }
    if (cityZone?.geojson) {
      polygonLayerRef.current = L.geoJSON(cityZone.geojson, {
        style: {
          color: "#e67e22",
          weight: 3,
          opacity: 0.9,
          fillOpacity: 0.04,
          dashArray: "10 5",
        },
      })
        .bindTooltip("🏙 Граница города", {
          permanent: true,
          direction: "center",
          className: "city-boundary-tooltip",
        })
        .addTo(map);
    }
    return () => { polygonLayerRef.current?.remove(); };
  }, [cityZone, map]);

  // Manage Geoman drawing
  useEffect(() => {
    const pm = (map as any).pm;
    if (!pm) return;

    if (!drawingActive) {
      pm.disableDraw();
      return;
    }

    pm.enableDraw("Polygon", { snappable: true, continueDrawing: false });

    const handleCreate = async (e: any) => {
      pm.disableDraw();
      const layer = e.layer as L.Polygon;
      const geojson = layer.toGeoJSON();
      let coords: number[][] = geojson.geometry.coordinates[0];

      // Close the ring
      if (coords.length > 0) {
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
      }

      const wkt = `POLYGON((${coords.map((c) => `${c[0]} ${c[1]}`).join(", ")}))`;

      try {
        // Delete existing boundary first
        if (cityZone) {
          await fetch(`/api/geozones/${cityZone.id}`, { method: "DELETE" });
        }
        // Save new boundary
        const res = await fetch("/api/geozones", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Граница города", type: "city_boundary", polygon: wkt }),
        });
        if (res.ok) {
          onZoneSaved();
        } else {
          alert("Ошибка сохранения границы");
        }
      } catch {
        alert("Ошибка сети при сохранении");
      } finally {
        map.removeLayer(layer);
        onDrawEnd();
      }
    };

    map.once("pm:create", handleCreate);
    return () => {
      pm.disableDraw();
      map.off("pm:create", handleCreate);
    };
  }, [drawingActive, map, cityZone, onZoneSaved, onDrawEnd]);

  return null;
}

// ─── Assign order modal ───────────────────────────────────────────────────────
function AssignOrderModal({ driver, onClose }: { driver: DriverLocation; onClose: () => void }) {
  const { currentOrders } = useMonitorStore();
  const pendingOrders = currentOrders.filter((o) => o.status === "pending");
  const [assigning, setAssigning] = useState(false);
  const [done, setDone] = useState(false);

  const assign = async (orderId: number) => {
    setAssigning(true);
    try {
      await fetch(`/api/orders/${orderId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: driver.driverId }),
      });
      setDone(true);
      setTimeout(onClose, 1000);
    } catch {
      alert("Ошибка при назначении");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 16, padding: 24, minWidth: 340, maxWidth: 440, maxHeight: "80vh", overflowY: "auto", color: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.8)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Закрепить заказ</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>→ {driver.lastName} {driver.firstName} · {driver.plate ?? `#${driver.driverId}`}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        {done ? (
          <div style={{ textAlign: "center", padding: 24, color: "#22c55e", fontWeight: 700 }}>✓ Назначен!</div>
        ) : pendingOrders.length === 0 ? (
          <div style={{ textAlign: "center", color: "#666", padding: 20 }}>Нет ожидающих заказов</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingOrders.map((order) => (
              <div key={order.id} style={{ background: "#111", borderRadius: 10, padding: "10px 14px", border: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>№{order.id}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{order.pickupAddress ?? "Адрес не указан"}</div>
                  {order.estimatedPrice && <div style={{ fontSize: 11, color: "#FFD000", marginTop: 1 }}>{order.estimatedPrice} ₸</div>}
                </div>
                <button onClick={() => assign(order.id)} disabled={assigning} style={{ background: "#FFD000", color: "#000", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", opacity: assigning ? 0.6 : 1 }}>
                  Назначить
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MapTabClient() {
  const { driverLocations } = useMonitorStore();
  const [showClusters, setShowClusters] = useState(false);
  const [assignTarget, setAssignTarget] = useState<DriverLocation | null>(null);
  const [drawingBoundary, setDrawingBoundary] = useState(false);
  const [cityZone, setCityZone] = useState<CityZone | null>(null);
  const [boundaryStatus, setBoundaryStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const drivers = Object.values(driverLocations);
  const freeCount  = drivers.filter((d) => d.status === "free").length;
  const busyCount  = drivers.filter((d) => d.status === "busy").length;
  const offlineCount = drivers.filter((d) => d.status === "offline").length;

  const fetchCityZone = useCallback(async () => {
    try {
      const res = await fetch("/api/geozones");
      const data = await res.json();
      if (Array.isArray(data)) {
        const boundary = data.find((z: any) => z.type === "city_boundary");
        setCityZone(boundary ? { id: boundary.id, geojson: boundary.geojson } : null);
      }
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchCityZone(); }, [fetchCityZone]);

  const handleZoneSaved = useCallback(async () => {
    setBoundaryStatus("saved");
    await fetchCityZone();
    setTimeout(() => setBoundaryStatus("idle"), 3000);
  }, [fetchCityZone]);

  const handleDrawEnd = useCallback(() => {
    setDrawingBoundary(false);
  }, []);

  const handleDeleteBoundary = async () => {
    if (!cityZone) return;
    if (!confirm("Удалить границу города?")) return;
    const res = await fetch(`/api/geozones/${cityZone.id}`, { method: "DELETE" });
    if (res.ok) {
      setCityZone(null);
    } else {
      alert("Ошибка удаления");
    }
  };

  const renderMarkers = () => {
    if (!showClusters || drivers.length < 3) {
      return drivers.map((driver) => (
        <Marker key={driver.driverId} position={[driver.lat, driver.lng]} icon={createDriverIcon(driver)}>
          <Popup minWidth={220}>
            <DriverPopupContent driver={driver} onAssign={() => setAssignTarget(driver)} />
          </Popup>
        </Marker>
      ));
    }

    const GRID = 0.005;
    const groups = groupDrivers(drivers, GRID);
    return Array.from(groups.entries()).map(([key, group]) => {
      if (group.length === 1) {
        const driver = group[0];
        return (
          <Marker key={driver.driverId} position={[driver.lat, driver.lng]} icon={createDriverIcon(driver)}>
            <Popup minWidth={220}>
              <DriverPopupContent driver={driver} onAssign={() => setAssignTarget(driver)} />
            </Popup>
          </Marker>
        );
      }
      const avgLat = group.reduce((s, d) => s + d.lat, 0) / group.length;
      const avgLng = group.reduce((s, d) => s + d.lng, 0) / group.length;
      return (
        <Marker key={key} position={[avgLat, avgLng]} icon={createClusterIcon(group.length)}>
          <Popup minWidth={240}>
            <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12, maxHeight: 300, overflowY: "auto" }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Группа: {group.length} водителей</div>
              {group.map((d) => (
                <div key={d.driverId} style={{ padding: "6px 0", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div>
                    <span style={{ fontWeight: 700 }}>{d.plate ?? `#${d.driverId}`}</span>{" · "}
                    <span style={{ color: STATUS_COLORS[d.status] ?? "#888", fontWeight: 700 }}>
                      {d.status === "free" ? "Свободен" : d.status === "busy" ? "На заказе" : "Офлайн"}
                    </span>
                    {d.lastName && <div style={{ color: "#555", fontSize: 11 }}>{d.lastName} {d.firstName}</div>}
                  </div>
                  <button onClick={() => setAssignTarget(d)} style={{ background: "#FFD000", border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    Закрепить
                  </button>
                </div>
              ))}
            </div>
          </Popup>
        </Marker>
      );
    });
  };

  return (
    <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button
          onClick={() => setShowClusters((v) => !v)}
          style={{
            background: showClusters ? "#FFD000" : "rgba(26,26,26,0.92)",
            color: showClusters ? "#000" : "#fff",
            border: "1px solid " + (showClusters ? "#FFD000" : "#333"),
            borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
          }}
        >
          {showClusters ? "⬡ Группировка ВКЛ" : "⬡ Группировать"}
        </button>

        {/* City boundary button */}
        {!drawingBoundary ? (
          <>
            <button
              onClick={() => setDrawingBoundary(true)}
              title={cityZone ? "Перерисовать границу города" : "Нарисовать границу города"}
              style={{
                background: cityZone ? "rgba(230,126,34,0.15)" : "rgba(26,26,26,0.92)",
                color: cityZone ? "#e67e22" : "#fff",
                border: "1px solid " + (cityZone ? "#e67e22" : "#333"),
                borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              🏙 {cityZone ? "Перерисовать границу" : "Нарисовать границу"}
            </button>
            {cityZone && (
              <button
                onClick={handleDeleteBoundary}
                title="Удалить границу города"
                style={{
                  background: "rgba(26,26,26,0.92)", color: "#ef4444",
                  border: "1px solid #3a1a1a", borderRadius: 8, padding: "6px 10px",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
                }}
              >
                🗑
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => setDrawingBoundary(false)}
            style={{
              background: "rgba(230,126,34,0.9)", color: "#fff",
              border: "1px solid #e67e22", borderRadius: 8, padding: "6px 14px",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)", animation: "pulse 1.5s infinite",
            }}
          >
            ✕ Отменить рисование
          </button>
        )}
      </div>

      {/* ── Drawing hint banner ─────────────────────────────────────────────── */}
      {drawingBoundary && (
        <div style={{
          position: "absolute", top: 52, left: "50%", transform: "translateX(-50%)",
          zIndex: 1000, background: "rgba(230,126,34,0.95)", color: "#fff",
          borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 700,
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", gap: 10,
          whiteSpace: "nowrap",
        }}>
          ✏️ Кликайте по карте чтобы отметить границу аула.
          Двойной клик или нажмите на первую точку — завершить.
        </div>
      )}

      {/* ── Save success banner ─────────────────────────────────────────────── */}
      {boundaryStatus === "saved" && (
        <div style={{
          position: "absolute", top: 52, left: "50%", transform: "translateX(-50%)",
          zIndex: 1000, background: "rgba(34,197,94,0.95)", color: "#fff",
          borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 700,
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }}>
          ✓ Граница города сохранена!
        </div>
      )}

      {/* ── Map ─────────────────────────────────────────────────────────────── */}
      <MapContainer center={[42.309, 69.969]} zoom={14} style={{ width: "100%", height: "100%" }} zoomControl={true}>
        <TileLayer
          attribution='&copy; <a href="https://yandex.ru/maps">Яндекс Карты</a>'
          url="https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU&projection=web_mercator"
          subdomains={[""]}
        />

        {/* City boundary drawing / display */}
        <CityBoundaryLayer
          drawingActive={drawingBoundary}
          cityZone={cityZone}
          onZoneSaved={handleZoneSaved}
          onDrawEnd={handleDrawEnd}
        />

        {renderMarkers()}
      </MapContainer>

      {/* ── Legend + stats ──────────────────────────────────────────────────── */}
      <div style={{
        position: "absolute", bottom: 10, right: 10,
        background: "rgba(15,15,15,0.92)", border: "1px solid #2a2a2a",
        borderRadius: 10, padding: "10px 14px", fontSize: 11, zIndex: 1000,
        display: "flex", flexDirection: "column", gap: 6,
        backdropFilter: "blur(6px)", color: "#ccc", minWidth: 140,
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", marginBottom: 2 }}>
          На карте: <span style={{ color: "#FFD000" }}>{drivers.length}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", display: "inline-block", flexShrink: 0 }} />
          Свободен · <strong style={{ color: "#fff" }}>{freeCount}</strong>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", display: "inline-block", flexShrink: 0 }} />
          На заказе · <strong style={{ color: "#fff" }}>{busyCount}</strong>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", display: "inline-block", flexShrink: 0 }} />
          Офлайн · <strong style={{ color: "#fff" }}>{offlineCount}</strong>
        </div>
        {cityZone && (
          <div style={{ borderTop: "1px solid #2a2a2a", marginTop: 4, paddingTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 14, height: 2, background: "#e67e22", display: "inline-block", borderRadius: 1 }} />
            <span style={{ color: "#e67e22", fontSize: 10, fontWeight: 700 }}>Граница города</span>
          </div>
        )}
      </div>

      {/* Assign order modal */}
      {assignTarget && <AssignOrderModal driver={assignTarget} onClose={() => setAssignTarget(null)} />}

      <style>{`
        .city-boundary-tooltip {
          background: rgba(230,126,34,0.9) !important;
          border: 1px solid #e67e22 !important;
          color: #fff !important;
          font-weight: 700 !important;
          font-size: 11px !important;
          border-radius: 6px !important;
          padding: 2px 8px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;
          white-space: nowrap !important;
        }
        .city-boundary-tooltip::before { border: none !important; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

// ─── Driver popup ─────────────────────────────────────────────────────────────
function DriverPopupContent({ driver, onAssign }: { driver: DriverLocation; onAssign: () => void }) {
  const statusLabel = driver.status === "free" ? "Свободен" : driver.status === "busy" ? "На заказе" : "Офлайн";
  const statusColor = STATUS_COLORS[driver.status] ?? "#888";
  return (
    <div style={{ fontFamily: "Inter, sans-serif", fontSize: 13, minWidth: 200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#1a1a1a" }}>
            {driver.plate ? (
              <span style={{ background: "#1a1a1a", color: "#FFD000", padding: "2px 8px", borderRadius: 4, fontFamily: "monospace", letterSpacing: 1 }}>{driver.plate}</span>
            ) : `Водитель #${driver.driverId}`}
          </div>
          {driver.vehicleLabel && <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>{driver.vehicleLabel}</div>}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: statusColor + "22", borderRadius: 12, padding: "2px 8px", border: `1px solid ${statusColor}44` }}>{statusLabel}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        {(driver.firstName || driver.lastName) && (
          <div style={{ display: "flex", gap: 6, color: "#555", fontSize: 12 }}>
            <span>👤</span><span>{driver.lastName} {driver.firstName}</span>
          </div>
        )}
        {driver.callsign && (
          <div style={{ display: "flex", gap: 6, color: "#555", fontSize: 12 }}>
            <span>📻</span><span>Позывной: <strong style={{ color: "#1a1a1a" }}>{driver.callsign}</strong></span>
          </div>
        )}
        {driver.phone && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            <span>📞</span><a href={`tel:${driver.phone}`} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>{driver.phone}</a>
          </div>
        )}
        <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>📍 {driver.lat.toFixed(5)}, {driver.lng.toFixed(5)}</div>
      </div>
      <button onClick={onAssign} style={{ width: "100%", background: "#FFD000", color: "#000", border: "none", borderRadius: 8, padding: "8px 0", fontSize: 12, fontWeight: 800, cursor: "pointer", letterSpacing: 0.3 }}>
        📋 Закрепить заказ
      </button>
    </div>
  );
}
