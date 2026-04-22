"use client";
import React from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const createMarkerIcon = (color: string, emoji: string) => {
  return new L.divIcon({
    className: "custom-map-marker",
    html: `<div style="
      background-color: ${color};
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 3px 6px rgba(0,0,0,0.3);
    ">
      <span style="transform: rotate(45deg); font-size: 16px;">${emoji}</span>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
};

const pickupIcon = createMarkerIcon("#3b82f6", "А");
const dropoffIcon = createMarkerIcon("#ef4444", "Б");
const driverIcon = createMarkerIcon("#eab308", "🚕");

function MapEvents({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (onMapClick) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FitBounds({ points, fitKey }: { points: [number, number][], fitKey?: number }) {
  const map = useMap();
  const hasFitted = React.useRef(false);
  const prevFitKey = React.useRef(fitKey);

  React.useEffect(() => {
    const forceFit = fitKey !== prevFitKey.current;
    if (forceFit) {
      prevFitKey.current = fitKey;
    }

    if (points.length > 0 && (!hasFitted.current || forceFit)) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      hasFitted.current = true;
    }
  }, [map, points, fitKey]);
  return null;
}

interface MiniMapProps {
  pickup?: [number, number] | null;
  dropoff?: [number, number] | null;
  driverLocation?: [number, number] | null;
  route?: [number, number][];
  onMapClick?: (lat: number, lng: number) => void;
  fitKey?: number;
}

export function MiniMap({ pickup, dropoff, driverLocation, route, onMapClick, fitKey }: MiniMapProps) {
  // Collect all points to fit map bounds
  const allPoints: [number, number][] = [];
  if (pickup) allPoints.push(pickup);
  if (dropoff) allPoints.push(dropoff);
  if (driverLocation) allPoints.push(driverLocation);
  if (route && route.length > 0) allPoints.push(...route);

  return (
    <MapContainer
      center={allPoints.length > 0 ? allPoints[0] : [42.309, 69.969]}
      zoom={allPoints.length > 0 ? undefined : 15}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
      attributionControl={false}
    >
      <TileLayer
        url="https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU&projection=web_mercator"
        subdomains={[""]}
      />
      <MapEvents onMapClick={onMapClick} />
      <FitBounds points={allPoints} fitKey={fitKey} />
      {pickup && <Marker position={pickup} icon={pickupIcon} />}
      {dropoff && <Marker position={dropoff} icon={dropoffIcon} />}
      {driverLocation && <Marker position={driverLocation} icon={driverIcon} />}
      {route && route.length > 0 && (
        <Polyline 
          positions={route} 
          color="#3b82f6" 
          weight={6} 
          opacity={0.9} 
        />
      )}
    </MapContainer>
  );
}

export default MiniMap;
