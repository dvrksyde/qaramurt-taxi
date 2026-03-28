"use client";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMonitorStore } from "@/stores/monitorStore";
import { useEffect, useState } from "react";
import type { DriverLocation } from "@/types";

// Fix Leaflet default marker icon issue with webpack
delete (L.Icon.Default.prototype as { _getIconUrl?: () => string })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom colored driver markers
function createDriverIcon(status: string): L.DivIcon {
  const colors: Record<string, string> = {
    free: "#3db84a",
    busy: "#f5c518",
    offline: "#e84646",
  };
  const color = colors[status] || "#888";
  return L.divIcon({
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:${color};border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
    "></div>`,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -8],
  });
}

export default function MapTabClient() {
  const { driverLocations } = useMonitorStore();
  const [showNames, setShowNames] = useState(false);
  const [showClusters, setShowClusters] = useState(true);

  const drivers = Object.values(driverLocations);

  return (
    <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      <MapContainer
        center={[51.18, 71.45]} // Astana / Nur-Sultan default center
        zoom={12}
        style={{ width: "100%", height: "100%" }}
        zoomControl={true}
      >
        <TileLayer
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {drivers.map((driver) => (
          <Marker
            key={driver.driverId}
            position={[driver.lat, driver.lng]}
            icon={createDriverIcon(driver.status)}
          >
            <Popup>
              <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12 }}>
                <strong>Водитель #{driver.driverId}</strong>
                {driver.callsign && <div>Позывной: {driver.callsign}</div>}
                <div style={{ marginTop: 4 }}>
                  Статус:{" "}
                  <span style={{
                    color: driver.status === "free" ? "#3db84a" : driver.status === "busy" ? "#d4a900" : "#e84646",
                    fontWeight: 700
                  }}>
                    {driver.status === "free" ? "Свободен" : driver.status === "busy" ? "На заказе" : "Офлайн"}
                  </span>
                </div>
                <div className="text-muted" style={{ marginTop: 2 }}>
                  {driver.lat.toFixed(5)}, {driver.lng.toFixed(5)}
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: 6 }}
                  onClick={() => {/* Open assign order */}}
                >
                  Назначить заказ
                </button>
              </div>
            </Popup>
          </Marker>
        ))}

        {drivers.length === 0 && <NoDriversOverlay />}
      </MapContainer>

      {/* Map overlay info */}
      <div style={{
        position: "absolute",
        bottom: 10, right: 10,
        background: "rgba(255,255,255,0.9)",
        border: "1px solid #ddd",
        borderRadius: 4,
        padding: "6px 10px",
        fontSize: 11,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3db84a", display: "inline-block" }} /> Свободен
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f5c518", display: "inline-block" }} /> На заказе
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#e84646", display: "inline-block" }} /> Офлайн
        </div>
        <div className="text-muted" style={{ borderTop: "1px solid #eee", paddingTop: 4, marginTop: 2 }}>
          Водителей на карте: {drivers.length}
        </div>
      </div>
    </div>
  );
}

function NoDriversOverlay() {
  const map = useMap();
  return null; // Just return null; empty map is fine
}
