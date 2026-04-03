"use client";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export default function MiniMap() {
  return (
    <MapContainer
      center={[42.309, 69.969]}
      zoom={10}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
      attributionControl={false}
    >
      <TileLayer
        url="https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU&projection=web_mercator"
        subdomains={[""]}
      />
    </MapContainer>
  );
}
