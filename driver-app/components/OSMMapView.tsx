import React, {
  useRef,
  useMemo,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { ActivityIndicator, StyleSheet, View, TouchableOpacity } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Point {
  latitude: number;
  longitude: number;
}

interface Props {
  userLocation?: Point | null;
  userHeading?: number | null;
  pickupLocation?: Point | null;
  dropoffLocation?: Point | null;
  autoFollow?: boolean;
  zoom?: number;
  showCenterButton?: boolean;
  /** Called with {downloaded, total} during preloadArea */
  onTileProgress?: (downloaded: number, total: number) => void;
}

export type OSMMapViewHandle = {
  centerOnMe: () => void;
  buildRoute: (from: Point, to: Point, fitBounds?: boolean) => void;
  clearRoute: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Pre-download OSM tiles for a radius around a point. Max zoom 15. */
  preloadArea: (lat: number, lng: number, radiusKm?: number) => void;
};

export type YandexMapViewHandle = OSMMapViewHandle;

// ─── Navigation arrow icon (Yandex-style) ────────────────────────────────────────
// A sharp teardrop arrow: wide base, pointed nose facing up (north = 0° bearing)
const CAR_SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <!-- Shadow -->
  <ellipse cx="20" cy="36" rx="7" ry="3" fill="rgba(0,0,0,0.25)"/>
  <!-- Arrow body: Yandex-style teardrop -->
  <path d="M20 3 L32 34 Q20 28 8 34 Z" fill="#1a73e8" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
  <!-- Center dot -->
  <circle cx="20" cy="21" r="3" fill="#fff" opacity="0.6"/>
</svg>
`)}`;

// ─── Component ────────────────────────────────────────────────────────────────

export const OSMMapView = forwardRef<OSMMapViewHandle, Props>((
  {
    userLocation,
    userHeading,
    pickupLocation,
    dropoffLocation,
    autoFollow = false,
    zoom = 15,
    showCenterButton = true,
    onTileProgress,
  },
  ref
) => {
  const webViewRef = useRef<WebView>(null);

  const initialCenterRef = useRef<Point | null>(null);
  if (!initialCenterRef.current) {
    initialCenterRef.current =
      userLocation ??
      pickupLocation ??
      dropoffLocation ?? {
        latitude: 42.3417,
        longitude: 69.5901, // Шымкент fallback
      };
  }

  // ── Imperative handle ─────────────────────────────────────────────────────

  const postMsg = useCallback((payload: object) => {
    webViewRef.current?.postMessage(JSON.stringify(payload));
  }, []);

  const centerOnMe = useCallback(() => {
    postMsg({ type: "centerOnDriver" });
  }, [postMsg]);

  const buildRoute = useCallback(
    (from: Point, to: Point, fitBounds = true) => {
      postMsg({
        type: "buildRoute",
        fromLat: from.latitude,
        fromLng: from.longitude,
        toLat: to.latitude,
        toLng: to.longitude,
        fitBounds,
      });
    },
    [postMsg]
  );

  const clearRoute = useCallback(() => {
    postMsg({ type: "clearRoute" });
  }, [postMsg]);

  const zoomIn = useCallback(() => postMsg({ type: 'zoomIn' }), [postMsg]);
  const zoomOut = useCallback(() => postMsg({ type: 'zoomOut' }), [postMsg]);

  const preloadArea = useCallback((lat: number, lng: number, radiusKm = 20) => {
    postMsg({ type: "preloadArea", lat, lng, radiusKm, maxZoom: 15 });
  }, [postMsg]);

  useImperativeHandle(ref, () => ({ centerOnMe, buildRoute, clearRoute, zoomIn, zoomOut, preloadArea }));

  // ── Driver position updates (no WebView re-render) ────────────────────────

  useEffect(() => {
    if (!userLocation) return;
    postMsg({
      type: "updateDriver",
      lat: userLocation.latitude,
      lng: userLocation.longitude,
      heading: userHeading ?? null,
      autoFollow,
    });
  }, [userLocation, userHeading, autoFollow, postMsg]);

  // ── Static HTML ─────────────────────────────────────────────────────────────

  const html = useMemo(() => {
    const initCenter = initialCenterRef.current!;

    const pickupMarkerCode = pickupLocation ? `
      var pickupEl = document.createElement('div');
      pickupEl.style.cssText = 'width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#22c55e;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;';
      pickupEl.innerHTML = '<span style="transform:rotate(45deg);font-size:14px;">А</span>';
      window.pickupMarker = new maplibregl.Marker({ element: pickupEl, anchor: 'bottom-left' })
        .setLngLat([${pickupLocation.longitude}, ${pickupLocation.latitude}])
        .addTo(map);
    ` : "";

    const dropoffMarkerCode = dropoffLocation ? `
      var dropoffEl = document.createElement('div');
      dropoffEl.style.cssText = 'width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#3b82f6;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;';
      dropoffEl.innerHTML = '<span style="transform:rotate(45deg);font-size:14px;">Б</span>';
      window.dropoffMarker = new maplibregl.Marker({ element: dropoffEl, anchor: 'bottom-left' })
        .setLngLat([${dropoffLocation.longitude}, ${dropoffLocation.latitude}])
        .addTo(map);
    ` : "";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"/>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"><\/script>
  <style>
    html, body, #map { margin:0; padding:0; width:100%; height:100%; background:#e8e0d8; overflow:hidden; }
    .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right,
    .maplibregl-ctrl-attrib { display:none !important; }
  </style>
</head>
<body>
<div id="map"></div>
<script>
  function log(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: msg }));
    }
  }
  function send(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }
  window.onerror = function(msg, src, line) { log('JS Error [' + line + ']: ' + msg); };

  // ── Tile cache via Cache API (MapLibre GL JS v4 async protocol) ──────────────
  var TILE_CACHE = 'qaramurt-osm-v1';
  var OSM_HOSTS = ['a','b','c'];

  // MapLibre v4 addProtocol: MUST return { data: ArrayBuffer } or throw
  maplibregl.addProtocol('cached', async function(params) {
    var url = params.url.replace('cached://', 'https://');
    try {
      // 1. Try cache first
      if ('caches' in window) {
        var cache = await caches.open(TILE_CACHE);
        var hit = await cache.match(url);
        if (hit) {
          var buf = await hit.arrayBuffer();
          return { data: buf };
        }
      }
      // 2. Fetch from network
      var resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.arrayBuffer();
      // 3. Store in cache for offline use
      if ('caches' in window) {
        var cache2 = await caches.open(TILE_CACHE);
        cache2.put(url, new Response(new Uint8Array(data), {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=604800' }
        }));
      }
      return { data: data };
    } catch (e) {
      throw new Error('Tile failed: ' + e);
    }
  });

  // ── Tile pre-download (supports multiple center points) ────────────────────
  function lngToX(lng, z) { return Math.floor((lng + 180) / 360 * Math.pow(2, z)); }
  function latToY(lat, z) {
    var r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
  }

  function buildUrlsForBox(minLat, maxLat, minLng, maxLng, maxZoom) {
    var urls = [];
    for (var z = 10; z <= maxZoom; z++) {
      var xMin = lngToX(minLng, z), xMax = lngToX(maxLng, z);
      var yMin = latToY(maxLat, z),  yMax = latToY(minLat, z);
      var host = OSM_HOSTS[z % 3]; // cycle between a/b/c
      for (var x = xMin; x <= xMax; x++) {
        for (var y = yMin; y <= yMax; y++) {
          urls.push('https://' + host + '.tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png');
        }
      }
    }
    return urls;
  }

  async function preloadArea(centerLat, centerLng, radiusKm, maxZoom) {
    if (!('caches' in window)) {
      log('Cache API not supported');
      return;
    }
    var latD = radiusKm / 111;
    var lngD = radiusKm / (111 * Math.cos(centerLat * Math.PI / 180));
    var urls = buildUrlsForBox(
      centerLat - latD, centerLat + latD,
      centerLng - lngD, centerLng + lngD,
      maxZoom
    );

    var total = urls.length;
    var done = 0;
    send({ type: 'tile_progress', downloaded: 0, total: total });
    var cache = await caches.open(TILE_CACHE);
    var BATCH = 6;
    for (var i = 0; i < urls.length; i += BATCH) {
      var batch = urls.slice(i, i + BATCH);
      await Promise.all(batch.map(async function(url) {
        try {
          if (!(await cache.match(url))) {
            var r = await fetch(url);
            if (r.ok) await cache.put(url, r);
          }
        } catch(e) {}
        done++;
        if (done % 50 === 0 || done === total) {
          send({ type: 'tile_progress', downloaded: done, total: total });
        }
      }));
    }
    send({ type: 'tile_done', downloaded: done, total: total });
    log('Preload done: ' + done + '/' + total);
  }

  // Pre-download ALL operating region tiles on map load ──────────────────────
  // Covers: Qaramurt, Aksukent, Akkala, Sarkyrama, Madenei, Khanaryk, Koksaiek, Shymkent
  // One big bounding box: lat [41.95, 42.85] lng [69.15, 70.30] zoom 10-14
  async function preloadOperatingRegion() {
    if (!('caches' in window)) return;
    log('Preloading operating region tiles...');
    var urls = buildUrlsForBox(41.95, 42.85, 69.15, 70.30, 14);
    // Remove duplicates
    var unique = [...new Set(urls)];
    var total = unique.length;
    var done = 0;
    send({ type: 'tile_progress', downloaded: 0, total: total });
    var cache = await caches.open(TILE_CACHE);
    var BATCH = 8;
    for (var i = 0; i < unique.length; i += BATCH) {
      var batch = unique.slice(i, i + BATCH);
      await Promise.all(batch.map(async function(url) {
        try {
          if (!(await cache.match(url))) {
            var r = await fetch(url);
            if (r.ok) await cache.put(url, r);
          }
        } catch(e) {}
        done++;
        if (done % 100 === 0 || done === total) {
          send({ type: 'tile_progress', downloaded: done, total: total });
        }
      }));
    }
    send({ type: 'tile_done', downloaded: done, total: total });
    log('Region preload done: ' + done + '/' + total);
  }

  // ── Bearing helper ──────────────────────────────────────────────────────────
  function bearing(lat1, lng1, lat2, lng2) {
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
          - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  // ── Map init — multi-subdomain OSM (a/b/c.tile.openstreetmap.org) ───────────
  var map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: [
            'cached://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'cached://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'cached://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: 'OpenStreetMap'
        }
      },
      layers: [{ id: 'osm-layer', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }]
    },
    center: [${initCenter.longitude}, ${initCenter.latitude}],
    zoom: ${zoom},
    attributionControl: false,
    logoPosition: 'bottom-right'
  });

  // ── State ───────────────────────────────────────────────────────────────────
  var driverMarker = null;
  var driverEl = null;
  var lastDriverLngLat = null;
  var currentHeading = 0;

  map.on('load', function() {
    log('MapLibre GL ready — OSM tiles (v4 protocol)');

    // Route line source + layer (added once, data updated on each buildRoute)
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#FFD000', 'line-width': 6, 'line-opacity': 0.9 }
    });
    map.addLayer({ id: 'route-line-outline', type: 'line', source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#000', 'line-width': 9, 'line-opacity': 0.15 }
    }, 'route-line');

    ${pickupMarkerCode}
    ${dropoffMarkerCode}

    // Start background tile pre-download for entire operating region after 10s delay
    // Covers: Qaramurt, Aksukent, Akkala, Sarkyrama, Madenei, Khanaryk, Koksaiek, Shymkent
    setTimeout(function() { preloadOperatingRegion(); }, 10000);
    log('Map layers ready');
  });

  // ── Message bus from React Native ───────────────────────────────────────────
  function processMessage(data) {
    try {
      // updateDriver
      if (data.type === 'updateDriver') {
        var lngLat = [data.lng, data.lat];
        var heading = (typeof data.heading === 'number') ? data.heading : null;

        if (heading === null && lastDriverLngLat) {
          heading = bearing(lastDriverLngLat[1], lastDriverLngLat[0], data.lat, data.lng);
        }
        currentHeading = heading || 0;
        lastDriverLngLat = lngLat;

        if (!driverMarker) {
          driverEl = document.createElement('img');
          driverEl.src = '${CAR_SVG}';
          driverEl.style.cssText = 'width:40px;height:40px;transform-origin:center;transition:transform 0.3s ease;';
          driverEl.style.transform = 'rotate(' + currentHeading + 'deg)';
          driverMarker = new maplibregl.Marker({ element: driverEl, rotationAlignment: 'map', anchor: 'center' })
            .setLngLat(lngLat)
            .addTo(map);
        } else {
          driverMarker.setLngLat(lngLat);
          driverEl.style.transform = 'rotate(' + currentHeading + 'deg)';
        }

        if (data.autoFollow) {
          map.easeTo({ center: lngLat, duration: 400 });
        }
      }

      // centerOnDriver
      if (data.type === 'centerOnDriver' && driverMarker) {
        map.flyTo({ center: driverMarker.getLngLat(), zoom: 16, duration: 600 });
      }

      // zoom
      if (data.type === 'zoomIn')  map.zoomIn();
      if (data.type === 'zoomOut') map.zoomOut();

      // buildRoute via OSRM
      if (data.type === 'buildRoute') {
        var url = 'https://router.project-osrm.org/route/v1/driving/'
          + data.fromLng + ',' + data.fromLat + ';'
          + data.toLng  + ',' + data.toLat
          + '?overview=full&geometries=geojson';

        fetch(url)
          .then(function(r) { return r.json(); })
          .then(function(json) {
            if (json.code !== 'Ok' || !json.routes || !json.routes[0]) {
              log('OSRM: no route');
              return;
            }
            var coords = json.routes[0].geometry.coordinates; // [lng, lat]
            map.getSource('route').setData({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: coords }
            });

            if (data.fitBounds && coords.length > 1) {
              var bounds = coords.reduce(function(b, c) {
                return b.extend(c);
              }, new maplibregl.LngLatBounds(coords[0], coords[0]));
              map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 600 });
            }
            log('Route built: ' + Math.round(json.routes[0].distance / 1000 * 10) / 10 + ' km');
          })
          .catch(function(e) { log('OSRM error: ' + e); });
      }

      // preloadArea
      if (data.type === 'preloadArea') {
        preloadArea(data.lat, data.lng, data.radiusKm || 20, data.maxZoom || 15);
      }

      // clearRoute
      if (data.type === 'clearRoute') {
        if (map.getSource('route')) {
          map.getSource('route').setData({
            type: 'Feature', geometry: { type: 'LineString', coordinates: [] }
          });
        }
      }

    } catch(e) { log('processMessage error: ' + e.message); }
  }

  document.addEventListener('message', function(e) { processMessage(JSON.parse(e.data)); });
  window.addEventListener('message',   function(e) { processMessage(JSON.parse(e.data)); });
<\/script>
</body>
</html>`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        allowFileAccess
        mixedContentMode="always"
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'log') {
              console.log('[OSMMap]', data.message);
            } else if (data.type === 'tile_progress' || data.type === 'tile_done') {
              onTileProgress?.(data.downloaded, data.total);
              console.log(`[OSMMap tiles] ${data.downloaded}/${data.total}`);
            }
          } catch (_) {}
        }}
        renderLoading={() => (
          <View style={styles.loader}>
            <ActivityIndicator color="#FFD000" size="large" />
          </View>
        )}
      />

      {showCenterButton && (
        <TouchableOpacity
          style={styles.centerBtn}
          onPress={centerOnMe}
          activeOpacity={0.75}
        >
          <Ionicons name="locate" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
});

// Backward-compatible alias so existing import of YandexMapView still works
export const YandexMapView = OSMMapView;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#e8e0d8",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#e8e0d8",
  },
  centerBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(26,26,46,0.88)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
});
