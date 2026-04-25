import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// @ts-ignore
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

// Interface for what the server returns
export interface GeozoneFeature {
  id: number;
  name: string;
  type: string;
  geojson?: any; // The ST_AsGeoJSON parsed result
}

interface Props {
  savedZones: GeozoneFeature[];
  onSaveSuccess: () => Promise<void>;
}

// Minimal GeoJSON to WKT converter for Polygons
function polygonToWKT(coords: any[]) {
  // WKT expects Longitude Latitude
  const points = coords.map((c) => `${c[0]} ${c[1]}`).join(", ");
  return `POLYGON((${points}))`;
}

export default function GeozoneMapClient({ savedZones, onSaveSuccess }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup>(L.layerGroup());

  useEffect(() => {
    if (!mapRef.current) return;

    // Initialize Map
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current).setView([42.309, 69.969], 14); // Карамурт, Сайрамский р-н
      
      L.tileLayer("https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU&projection=web_mercator", {
        attribution: "© Яндекс Карты",
      }).addTo(mapInstance.current);

      layersRef.current.addTo(mapInstance.current);

      // Add Geoman controls
      mapInstance.current.pm.addControls({
        position: "topleft",
        drawMarker: false,
        drawCircle: false,
        drawPolyline: false,
        drawRectangle: false,
        drawCircleMarker: false,
        drawText: false,
        editMode: false,
        dragMode: false,
        cutPolygon: false,
        removalMode: false,
      });

      // Handle custom drawing creation
      mapInstance.current.on("pm:create", async (e: any) => {
        const layer = e.layer as L.Polygon;
        // Grab geojson coordinates
        const geojson = layer.toGeoJSON();
        let coords: any[] = geojson.geometry.coordinates[0];
        
        // Ensure ring is closed
        if (coords.length > 0) {
          const first = coords[0];
          const last = coords[coords.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
             coords.push([...first]);
          }
        }

        const wkt = polygonToWKT(coords);
        const name = prompt("Введите название геозоны:");
        if (!name) {
          mapInstance.current?.removeLayer(layer);
          return;
        }

        const typeChoice = prompt(
          "Тип геозоны:\n1 — Обычная зона (ценовая надбавка)\n2 — Граница города (смена тарифа)\n\nВведите 1 или 2:",
          "1"
        );
        const type = typeChoice === "2" ? "city_boundary" : "zone";

        try {
          const res = await fetch("/api/geozones", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, type, polygon: wkt })
          });
          if (res.ok) {
            alert("Геозона сохранена!");
            await onSaveSuccess();
          } else {
            console.error(await res.text());
            alert("Ошибка сохранения.");
          }
        } catch (err) {
          console.error(err);
          alert("Ошибка сети");
        } finally {
          mapInstance.current?.removeLayer(layer); // Clean up temp UI layer, re-fetch will draw it
        }
      });
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [onSaveSuccess]);

  // Sync saved zones to map
  useEffect(() => {
    if (!mapInstance.current) return;
    
    layersRef.current.clearLayers();
    
    savedZones.forEach(zone => {
      if (zone.geojson) {
        const isCityBoundary = zone.type === "city_boundary";
        const layer = L.geoJSON(zone.geojson, {
          style: {
            color: isCityBoundary ? "#e67e22" : "var(--color-primary)",
            weight: isCityBoundary ? 3 : 2,
            opacity: 0.9,
            fillOpacity: isCityBoundary ? 0.05 : 0.2,
            dashArray: isCityBoundary ? "8 4" : undefined,
          }
        }).bindTooltip(
          isCityBoundary ? `🏙 ${zone.name} (Граница города)` : zone.name,
          { permanent: true, direction: "center", className: "geozone-tooltip" }
        );
        
        layersRef.current.addLayer(layer);
      }
    });
  }, [savedZones]);

  return (
    <>
      <style>{`
        .geozone-tooltip {
          background: transparent;
          border: none;
          box-shadow: none;
          color: #111;
          font-weight: bold;
          text-shadow: 0px 0px 3px white, 0px 0px 3px white;
        }
      `}</style>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}>
        <div ref={mapRef} style={{ width: "100%", height: "100%", backgroundColor: "#333" }} />
      </div>
    </>
  );
}
