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
  const { updateOrder } = useMonitorStore();

  const loadOrder = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      const data = await res.json();
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
            <span className="status-badge" style={{ background: "var(--color-bg-2)", color: "var(--color-text-1)" }}>#{order.id}</span>
            <h3 style={{ margin: 0 }}>Информация о заказе</h3>
          </div>
          <div className="flex-row">
            <button className="btn btn-ghost" onClick={loadOrder} title="Обновить">🔄</button>
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
              />
            </div>

            <div className="info-section">
              <h4>Маршрут</h4>
              <div className="flex-row" style={{ alignItems: "flex-start", gap: 12 }}>
                <div style={{ padding: "4px 0" }}>🔵</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{order.pickupAddress || "Не указан"}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>Точка А</div>
                </div>
              </div>
              <div style={{ borderLeft: "2px dashed #ddd", marginLeft: 8, height: 20, margin: "4px 8px" }}></div>
              <div className="flex-row" style={{ alignItems: "flex-start", gap: 12 }}>
                <div style={{ padding: "4px 0" }}>🔴</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{order.dropoffAddress || "Не указан"}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>Точка Б</div>
                </div>
              </div>
            </div>

            {/* Track Info */}
            {(order.status === "in_progress" || order.status === "completed") && (
              <div className="details-card" style={{ marginTop: -4 }}>
                <div className="card-label">Трек поездки</div>
                <div style={{ marginTop: 8, fontSize: 13, color: "#333", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div className="flex-row" style={{ justifyContent: "space-between" }}>
                    <span style={{ color: "#666" }}>GPS точек:</span>
                    <strong>{trackPointsCount} шт.</strong>
                  </div>
                  {order.distanceKm && (
                    <div className="flex-row" style={{ justifyContent: "space-between" }}>
                      <span style={{ color: "#666" }}>Дистанция:</span>
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
                        style={{ color: currentRank >= 5 ? "#ccc" : "var(--status-free)" }}
                      >
                        Завершить
                      </button>
                      <button 
                        className="btn btn-ghost btn-sm" 
                        disabled={currentRank >= 5}
                        onClick={() => handleStatusChange("canceled")} 
                        style={{ color: currentRank >= 5 ? "#ccc" : "var(--status-offline)", gridColumn: "span 2" }}
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
              <div className="card-label">Водитель</div>
              {order.driver ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>
                    {order.driver.callsign && <span className="callsign-tag" style={{ marginRight: 8 }}>{order.driver.callsign}</span>}
                    {order.driver.lastName} {order.driver.firstName}
                  </div>
                  <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                    {order.driver.phone}
                  </div>
                </div>
              ) : (
                <div style={{ padding: "12px 0", color: "#999", fontStyle: "italic" }}>Водитель не назначен</div>
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
                  <div style={{ display: "inline-block", background: "#eee", padding: "4px 8px", borderRadius: 4, fontWeight: 700, marginTop: 6, border: "1px solid #ccc", fontSize: 16, color: "#333" }}>
                    {order.vehicle.plate}
                  </div>
                </div>
              ) : (
                <div style={{ padding: "12px 0", color: "#999", fontStyle: "italic" }}>Данные об авто отсутствуют</div>
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
          background: white;
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.2);
        }
        .details-card {
          padding: 16px;
          background: #f8f9fa;
          border-radius: 12px;
          border: 1px solid #eee;
        }
        .card-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #999;
          font-weight: 700;
        }
        .callsign-tag {
          background: #333;
          color: white;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 13px;
        }
        .info-section h4 {
          margin: 0 0 12px 0;
          font-size: 14px;
          color: #333;
        }
      `}</style>
    </div>
  );
}
