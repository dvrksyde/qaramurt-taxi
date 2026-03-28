"use client";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export default function MiniMap() {
  return (
    <MapContainer
      center={[51.18, 71.45]}
      zoom={10}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
      attributionControl={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    </MapContainer>
  );
}
