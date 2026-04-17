"use client";
import React from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet icons (next.js standard problem)
const pickupIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
  iconSize: [25, 41], iconAnchor: [12, 41],
});
const dropoffIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  iconSize: [25, 41], iconAnchor: [12, 41],
});

const driverIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-yellow.png",
  iconSize: [25, 41], iconAnchor: [12, 41],
});

function MapEvents({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (onMapClick) onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  React.useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [map, points]);
  return null;
}

interface MiniMapProps {
  pickup?: [number, number] | null;
  dropoff?: [number, number] | null;
  driverLocation?: [number, number] | null;
  route?: [number, number][];
  onMapClick?: (lat: number, lng: number) => void;
}

export function MiniMap({ pickup, dropoff, driverLocation, route, onMapClick }: MiniMapProps) {
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
      <FitBounds points={allPoints} />
      {pickup && <Marker position={pickup} icon={pickupIcon} />}
      {dropoff && <Marker position={dropoff} icon={dropoffIcon} />}
      {driverLocation && <Marker position={driverLocation} icon={driverIcon} />}
      {route && route.length > 0 && (
        <Polyline 
          positions={route} 
          color="#FFD000" 
          weight={6} 
          opacity={0.9} 
        />
      )}
    </MapContainer>
  );
}

export default MiniMap;
