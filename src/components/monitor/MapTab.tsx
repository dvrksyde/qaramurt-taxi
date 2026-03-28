"use client";
import dynamic from "next/dynamic";
import { useMonitorStore } from "@/stores/monitorStore";

// Lazy-load the map to avoid SSR issues with Leaflet
const MapTabClient = dynamic(() => import("./MapTabClient"), { ssr: false, loading: () => (
  <div className="flex-center" style={{ flex: 1, color: "var(--color-text-3)" }}>
    Загрузка карты...
  </div>
) });

export function MapTab() {
  return <MapTabClient />;
}
