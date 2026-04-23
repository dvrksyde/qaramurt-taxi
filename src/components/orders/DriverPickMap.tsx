"use client";
import React from "react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface DriverMapPin {
  id: number;
  callsign: string | null;
  firstName: string;
  lastName: string;
  status: string;
  lat: number;
  lng: number;
}

interface Props {
  drivers: DriverMapPin[];
  pickup?: [number, number] | null;
  selectedDriverId: number | null;
  onSelectDriver: (id: number) => void;
}

function createDriverIcon(callsign: string | null, selected: boolean, status: string) {
  const isFree = status === "free";
  const bg = selected ? "#0984e3" : isFree ? "#00b894" : "#636e72";
  const border = selected ? "#fff" : "rgba(255,255,255,0.8)";
  const label = callsign || "?";
  return L.divIcon({
    className: "",
    html: `<div style="
      background: ${bg};
      color: white;
      font-weight: 700;
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 20px;
      border: 2px solid ${border};
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      white-space: nowrap;
      cursor: pointer;
      transition: transform 0.15s;
      transform: ${selected ? "scale(1.15)" : "scale(1)"};
      display: flex;
      align-items: center;
      gap: 4px;
    ">
      <span style="font-size:14px">🚕</span>${label}
    </div>`,
    iconSize: [undefined as any, undefined as any],
    iconAnchor: [24, 16],
  });
}

function createPickupIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      background:#3b82f6;width:32px;height:32px;
      display:flex;align-items:center;justify-content:center;
      border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      border:2px solid white;box-shadow:0 3px 6px rgba(0,0,0,0.3);
    "><span style="transform:rotate(45deg);font-size:15px">А</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

function AutoFit({ drivers, pickup }: { drivers: DriverMapPin[]; pickup?: [number, number] | null }) {
  const map = useMap();
  const fitted = React.useRef(false);
  React.useEffect(() => {
    if (fitted.current) return;
    const points: [number, number][] = drivers.map((d) => [d.lat, d.lng]);
    if (pickup) points.push(pickup);
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 });
      fitted.current = true;
    }
  }, [map, drivers, pickup]);
  return null;
}

export function DriverPickMap({ drivers, pickup, selectedDriverId, onSelectDriver }: Props) {
  const center: [number, number] = pickup ?? (drivers[0] ? [drivers[0].lat, drivers[0].lng] : [42.309, 69.969]);

  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
      attributionControl={false}
    >
      <TileLayer
        url="https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU&projection=web_mercator"
        subdomains={[""]}
      />
      <AutoFit drivers={drivers} pickup={pickup} />

      {/* Pickup point */}
      {pickup && <Marker position={pickup} icon={createPickupIcon()} />}

      {/* Driver markers */}
      {drivers.map((d) => (
        <Marker
          key={d.id}
          position={[d.lat, d.lng]}
          icon={createDriverIcon(d.callsign, selectedDriverId === d.id, d.status)}
          eventHandlers={{ click: () => onSelectDriver(d.id) }}
        >
          <Tooltip direction="top" offset={[0, -8]} opacity={0.95} permanent={false}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {d.callsign && <span style={{ marginRight: 4 }}>#{d.callsign}</span>}
              {d.lastName} {d.firstName}
              <br />
              <span style={{ color: d.status === "free" ? "#00b894" : "#636e72" }}>
                {d.status === "free" ? "Свободен" : "Оффлайн"}
              </span>
            </div>
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}

export default DriverPickMap;
