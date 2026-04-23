"use client";
import { useEffect, useState } from "react";
import { useMonitorStore } from "@/stores/monitorStore";
import type { Order } from "@/types";
import dynamic from "next/dynamic";

const MiniMap = dynamic(() => import("./MiniMap"), { ssr: false });

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает",
  assigned: "Назначен",
  arrived: "На месте",
  in_progress: "Везёт",
  completed: "Завершён",
  canceled: "Отменён",
};

export function OrderDetailsModal({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const [order, setOrder] = useState<any>(null);
  const [track, setTrack] = useState<[number, number][]>([]);
  const [trackPointsCount, setTrackPointsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mapFitKey, setMapFitKey] = useState(0);
  const { updateOrder } = useMonitorStore();

  // Reassign state
  const [showReassign, setShowReassign] = useState(false);
  const [freeDrivers, setFreeDrivers] = useState<any[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [driverSearch, setDriverSearch] = useState("");

  const loadOrder = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};

      if (data.data) {
        setOrder(data.data);

        // Load GPS track if order is active or completed
        if (data.data.status === "in_progress" || data.data.status === "completed") {
          try {
            const trackRes = await fetch(`/api/orders/${orderId}/trip`);
            const trackData = await trackRes.json();
            if (trackData.data && trackData.data.length > 0) {
              setTrack(trackData.data.map((p: any) => [p.lat, p.lng]));
              setTrackPointsCount(trackData.data.length);
            }
          } catch (e) {
            console.error("Failed to load track", e);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load order info", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrder();
    const interval = setInterval(loadOrder, 10000); // Poll every 10 seconds for real-time updates
    return () => clearInterval(interval);
  }, [orderId]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.data) {
        setOrder(data.data);
        updateOrder(orderId, { status: newStatus as any });
      }
    } catch (err) {
      alert("Ошибка при обновлении статуса");
    }
  };

  const openReassign = async () => {
    setShowReassign(true);
    setSelectedDriverId(null);
    setDriverSearch("");
    setLoadingDrivers(true);
    try {
      const res = await fetch("/api/drivers?sortBy=callsign&sortDir=asc");
      const data = await res.json();
      // Show all active, non-busy drivers
      const available = (data.data || []).filter((d: any) =>
        d.isActive && d.status !== "busy" && d.id !== order?.driverId
      );
      setFreeDrivers(available);
    } catch {
      setFreeDrivers([]);
    } finally {
      setLoadingDrivers(false);
    }
  };

  const handleReassign = async () => {
    if (!selectedDriverId) return;
    setReassigning(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newDriverId: selectedDriverId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Ошибка переназначения");
        return;
      }
      setOrder(data.data);
      updateOrder(orderId, { status: "assigned" as any, driverId: selectedDriverId } as any);
      setShowReassign(false);
    } catch {
      alert("Ошибка при переназначении");
    } finally {
      setReassigning(false);
    }
  };

  if (!order && loading) {
    return (
      <div className="modal-overlay">
        <div className="modal" style={{ width: 400, textAlign: "center", padding: 40 }}>
          <div className="pulse">Загрузка данных...</div>
        </div>
      </div>
    );
  }

  if (!order) return null;

  // Driver location parsing "POINT(lng lat)" -> [lat, lng]
  let driverPos: [number, number] | null = null;
  if (order.driver?.currentLocation) {
    const match = order.driver.currentLocation.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    if (match) {
      driverPos = [parseFloat(match[2]), parseFloat(match[1])];
    }
  }

  // Pickup/Dropoff points parsing
  const parsePoint = (pt: string | null): [number, number] | null => {
    if (!pt) return null;
    const match = pt.match(/POINT\(([^ ]+) ([^ ]+)\)/);
    return match ? [parseFloat(match[2]), parseFloat(match[1])] : null;
  };

  const pickup = parsePoint(order.pickupPoint);
  const dropoff = parsePoint(order.dropoffPoint);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal order-details-modal" style={{ width: 800, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div className="modal-header">
          <div className="flex-row">
            <span className="status-badge" style={{ background: "var(--color-border)", color: "var(--color-text-2)" }}>#{order.id}</span>
            <h3 style={{ margin: 0 }}>Информация о заказе</h3>
          </div>
          <div className="flex-row">
            <button className="btn btn-ghost" onClick={() => { loadOrder(); setMapFitKey(k => k + 1); }} title="Обновить">🔄</button>
            <button className="btn btn-ghost" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="modal-body" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, padding: 20, flex: 1, overflowY: "auto" }}>

          {/* Left Column: Map & Route */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ height: 350, borderRadius: 12, overflow: "hidden", border: "1px solid var(--color-border)", position: "relative" }}>
              <MiniMap
                pickup={pickup}
                dropoff={dropoff}
                driverLocation={driverPos}
                route={track}
                fitKey={mapFitKey}
              />
            </div>

            <div className="info-section">
              <h4>Маршрут</h4>
              <div className="flex-row" style={{ alignItems: "flex-start", gap: 12 }}>
                <div style={{ padding: "4px 0" }}>🔵</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{order.pickupAddress || "Не указан"}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-3)" }}>Точка А</div>
                </div>
              </div>
              <div style={{ borderLeft: "2px dashed var(--color-border)", marginLeft: 8, height: 20, margin: "4px 8px" }}></div>
              <div className="flex-row" style={{ alignItems: "flex-start", gap: 12 }}>
                <div style={{ padding: "4px 0" }}>🔴</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{order.dropoffAddress || "Не указан"}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-3)" }}>Точка Б</div>
                </div>
              </div>
            </div>

            {/* Track Info */}
            {(order.status === "in_progress" || order.status === "completed") && (
              <div className="details-card" style={{ marginTop: -4 }}>
                <div className="card-label">Трек поездки</div>
                <div style={{ marginTop: 8, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div className="flex-row" style={{ justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-text-2)" }}>GPS точек:</span>
                    <strong>{trackPointsCount} шт.</strong>
                  </div>
                  {order.distanceKm && (
                    <div className="flex-row" style={{ justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-text-2)" }}>Дистанция:</span>
                      <strong>{Number(order.distanceKm).toFixed(1)} км</strong>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Order/Driver Info & Status */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Status Section */}
            <div className="details-card">
              <div className="card-label">Текущий статус</div>
              <div className="flex-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                <span className={`status-badge ${order.status}`} style={{ fontSize: 16, padding: "6px 12px" }}>
                  {STATUS_LABELS[order.status]}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                {(() => {
                  const ranks: Record<string, number> = {
                    pending: 1, assigned: 2, arrived: 3, in_progress: 4, completed: 5, canceled: 5
                  };
                  const currentRank = ranks[order.status] || 0;

                  return (
                    <>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={currentRank >= 2}
                        onClick={() => handleStatusChange("assigned")}
                      >
                        Назначить
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={currentRank >= 3}
                        onClick={() => handleStatusChange("arrived")}
                      >
                        На месте
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={currentRank >= 4}
                        onClick={() => handleStatusChange("in_progress")}
                      >
                        Везёт
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={currentRank >= 5}
                        onClick={() => handleStatusChange("completed")}
                        style={{ color: currentRank >= 5 ? "var(--color-text-3)" : "var(--status-free)" }}
                      >
                        Завершить
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={currentRank >= 5}
                        onClick={() => handleStatusChange("canceled")}
                        style={{ color: currentRank >= 5 ? "var(--color-text-3)" : "var(--status-offline)", gridColumn: "span 2" }}
                      >
                        Отменить заказ
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Driver Section */}
            <div className="details-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="card-label">Водитель</div>
                {order.status !== "completed" && order.status !== "canceled" && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={openReassign}
                    style={{ fontSize: 12, padding: "4px 10px", color: "#0984e3" }}
                  >
                    🔄 Переназначить
                  </button>
                )}
              </div>
              {order.driver ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                    {order.driver.callsign && <span className="callsign-tag" style={{ marginRight: 8 }}>{order.driver.callsign}</span>}
                    {order.driver.lastName} {order.driver.firstName}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--color-text-2)", marginTop: 4 }}>
                    {order.driver.phone}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8 }}>
                  <span style={{ color: "var(--color-text-3)", fontStyle: "italic" }}>Водитель не назначен</span>
                </div>
              )}

              {/* Reassign Panel */}
              {showReassign && (
                <div style={{ marginTop: 12, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-2)", marginBottom: 8, textTransform: "uppercase" }}>
                    Выбрать нового водителя
                  </div>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Поиск по позывному или имени..."
                    value={driverSearch}
                    onChange={(e) => setDriverSearch(e.target.value)}
                    style={{
                      width: "100%", padding: "8px 10px", border: "1px solid var(--color-border)",
                      borderRadius: 8, background: "var(--color-surface)", color: "var(--color-text)",
                      fontSize: 13, boxSizing: "border-box", marginBottom: 8, outline: "none",
                    }}
                  />
                  {loadingDrivers ? (
                    <div style={{ textAlign: "center", padding: 12, color: "var(--color-text-3)" }}>Загрузка...</div>
                  ) : (
                    <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                      {freeDrivers
                        .filter((d) => {
                          const q = driverSearch.toLowerCase();
                          return !q ||
                            d.callsign?.toLowerCase().includes(q) ||
                            d.firstName?.toLowerCase().includes(q) ||
                            d.lastName?.toLowerCase().includes(q) ||
                            d.phone?.includes(q);
                        })
                        .map((d) => (
                          <div
                            key={d.id}
                            onClick={() => setSelectedDriverId(d.id === selectedDriverId ? null : d.id)}
                            style={{
                              padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13,
                              background: selectedDriverId === d.id ? "rgba(9, 132, 227, 0.12)" : "var(--color-surface)",
                              border: selectedDriverId === d.id ? "1px solid #0984e3" : "1px solid var(--color-border)",
                              display: "flex", justifyContent: "space-between", alignItems: "center",
                            }}
                          >
                            <div>
                              {d.callsign && <strong style={{ marginRight: 6 }}>{d.callsign}</strong>}
                              {d.lastName} {d.firstName}
                            </div>
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                              background: d.status === "free" ? "rgba(0,184,148,0.15)" : "rgba(99,110,114,0.15)",
                              color: d.status === "free" ? "#00b894" : "var(--color-text-3)",
                            }}>
                              {d.status === "free" ? "Свободен" : "Оффлайн"}
                            </span>
                          </div>
                        ))}
                      {freeDrivers.filter((d) => {
                        const q = driverSearch.toLowerCase();
                        return !q || d.callsign?.toLowerCase().includes(q) || d.firstName?.toLowerCase().includes(q) || d.lastName?.toLowerCase().includes(q);
                      }).length === 0 && (
                          <div style={{ textAlign: "center", padding: 16, color: "var(--color-text-3)" }}>Нет доступных водителей</div>
                        )}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleReassign}
                      disabled={!selectedDriverId || reassigning}
                      style={{ flex: 1 }}
                    >
                      {reassigning ? "Переназначаю..." : "✓ Назначить"}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowReassign(false)}
                      style={{ flex: 1 }}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Vehicle Section */}
            <div className="details-card">
              <div className="card-label">Автомобиль</div>
              {order.vehicle ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {order.vehicle.color} {order.vehicle.make} {order.vehicle.model}
                  </div>
                  <span className="license-plate" style={{ marginTop: 8, display: "inline-block" }}>
                    {order.vehicle.plate}
                  </span>
                </div>
              ) : (
                <div style={{ padding: "12px 0", color: "var(--color-text-3)", fontStyle: "italic" }}>Данные об авто отсутствуют</div>
              )}
            </div>

            {/* Price Section */}
            <div className="details-card" style={{ background: "var(--color-primary)", color: "white" }}>
              <div className="card-label" style={{ color: "rgba(255,255,255,0.7)" }}>Стоимость</div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>
                {order.finalPrice || order.estimatedPrice || 0} <span style={{ fontSize: 16 }}>₸</span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                Дистанция: {order.distanceKm ? `${Number(order.distanceKm).toFixed(1)} км` : "—"}
              </div>
            </div>

          </div>
        </div>
      </div>

      <style jsx>{`
        .order-details-modal {
          background: var(--color-surface);
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.35);
          border: 1px solid var(--color-border);
        }
        .details-card {
          padding: 16px;
          background: var(--color-surface-2);
          border-radius: 12px;
          border: 1px solid var(--color-border);
        }
        .card-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-3);
          font-weight: 700;
        }
        .callsign-tag {
          background: var(--color-border-2);
          color: var(--color-text);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 13px;
        }
        .info-section h4 {
          margin: 0 0 12px 0;
          font-size: 14px;
          color: #eeeeeeff;
        }
      `}</style>
    </div>
  );
}
