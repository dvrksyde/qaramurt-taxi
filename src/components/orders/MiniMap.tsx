"use client";
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from "react-leaflet";
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

interface MiniMapProps {
  pickup?: [number, number] | null;
  dropoff?: [number, number] | null;
  driverLocation?: [number, number] | null;
  route?: [number, number][];
  onMapClick?: (lat: number, lng: number) => void;
}

export function MiniMap({ pickup, dropoff, driverLocation, route, onMapClick }: MiniMapProps) {
  return (
    <MapContainer
      center={[42.309, 69.969]}
      zoom={15}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
      attributionControl={false}
    >
      <TileLayer
        url="https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU&projection=web_mercator"
        subdomains={[""]}
      />
      <MapEvents onMapClick={onMapClick} />
      {pickup && <Marker position={pickup} icon={pickupIcon} />}
      {dropoff && <Marker position={dropoff} icon={dropoffIcon} />}
      {driverLocation && <Marker position={driverLocation} icon={driverIcon} />}
      {route && route.length > 0 && (
        <Polyline 
          positions={route} 
          color="#4177f6" 
          weight={6} 
          opacity={0.8} 
        />
      )}
    </MapContainer>
  );
}

export default MiniMap;
