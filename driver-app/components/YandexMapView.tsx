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
  /** Current driver position — updates driver icon via postMessage (no re-render). */
  userLocation?: Point | null;
  /** Current driver heading in degrees (0 = north). Rotates the car icon. */
  userHeading?: number | null;
  /** Pickup point marker (green). */
  pickupLocation?: Point | null;
  /** Dropoff point marker (blue). Set to null when not needed. */
  dropoffLocation?: Point | null;
  /** If true, the map re-centres on the driver every time userLocation changes. */
  autoFollow?: boolean;
  /** Initial zoom level (default 15). */
  zoom?: number;
  /** Show the "centre on me" button (default true). */
  showCenterButton?: boolean;
}

export type YandexMapViewHandle = {
  /** Pan the map to the driver's last known position. */
  centerOnMe: () => void;
  /**
   * Build a turn-by-turn route from `from` to `to` using Yandex Maps routing.
   * @param fitBounds  If true, zoom the map to fit the whole route.
   */
  buildRoute: (from: Point, to: Point, fitBounds?: boolean) => void;
  /** Remove the active route polyline from the map. */
  clearRoute: () => void;
};

// ─── SVG car icon (top-down view, pointing north = 0°) ────────────────────────
// Encoded as a data-URI so it works inside the WebView sandbox with no network request.
const CAR_SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
  <rect x="11" y="6" width="18" height="28" rx="6" fill="#FFD000" stroke="#000" stroke-width="1.5"/>
  <rect x="13" y="10" width="14" height="10" rx="2" fill="#1a1a2e" opacity="0.7"/>
  <rect x="9" y="12" width="4" height="7" rx="2" fill="#333"/>
  <rect x="27" y="12" width="4" height="7" rx="2" fill="#333"/>
  <rect x="10" y="27" width="4" height="5" rx="1.5" fill="#333"/>
  <rect x="26" y="27" width="4" height="5" rx="1.5" fill="#333"/>
  <circle cx="20" cy="20" r="3" fill="#000" opacity="0.25"/>
</svg>
`)}`;

// ─── Component ────────────────────────────────────────────────────────────────

export const YandexMapView = forwardRef<YandexMapViewHandle, Props>((
  {
    userLocation,
    userHeading,
    pickupLocation,
    dropoffLocation,
    autoFollow = false,
    zoom = 15,
    showCenterButton = true,
  },
  ref
) => {
  const webViewRef = useRef<WebView>(null);

  // Capture the very first non-null location as the map's initial centre.
  // We keep it in a ref so the HTML memo never needs to re-run.
  const initialCenterRef = useRef<Point | null>(null);
  if (!initialCenterRef.current) {
    initialCenterRef.current =
      userLocation ??
      pickupLocation ??
      dropoffLocation ?? {
        latitude: 42.3417,
        longitude: 69.5901, // Shymkent centre fallback
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

  useImperativeHandle(ref, () => ({ centerOnMe, buildRoute, clearRoute }));

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

  // ── Static HTML — built once, never changes ───────────────────────────────

  const html = useMemo(() => {
    const initCenter = initialCenterRef.current!;

    const pickupMarkerCode = pickupLocation
      ? `
        window.pickupPlacemark = new ymaps.Placemark(
          [${pickupLocation.latitude}, ${pickupLocation.longitude}],
          { balloonContentHeader: 'Подача' },
          { preset: 'islands#greenCircleDotIcon' }
        );
        map.geoObjects.add(window.pickupPlacemark);
      `
      : "";

    const dropoffMarkerCode = dropoffLocation
      ? `
        window.dropoffPlacemark = new ymaps.Placemark(
          [${dropoffLocation.latitude}, ${dropoffLocation.longitude}],
          { balloonContentHeader: 'Назначение' },
          { preset: 'islands#blueCircleDotIcon' }
        );
        map.geoObjects.add(window.dropoffPlacemark);
      `
      : "";

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #1a1a2e; overflow: hidden; }
    [class*="copyrights-pane"], [class*="copyright"] { display: none !important; }
  </style>
  <script src="https://api-maps.yandex.ru/2.1/?lang=ru_RU&load=package.full"></script>
</head>
<body>
<div id="map"></div>
<script>
  // ── helpers ──────────────────────────────────────────────────────────────
  function log(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: msg }));
    }
  }
  window.onerror = function(msg, src, line) { log('JS Error [' + line + ']: ' + msg); };

  // Compute bearing between two [lat,lng] pairs (degrees, 0=north)
  function bearing(lat1, lng1, lat2, lng2) {
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var y    = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    var x    = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
              - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  // ── state ────────────────────────────────────────────────────────────────
  var map;
  var driverPlacemark = null;
  var currentRoute    = null;
  var lastDriverCoords = null;  // [lat, lng]

  // SVG car icon (data-URI, no network needed)
  var CAR_ICON = '${CAR_SVG}';

  // ── map init ─────────────────────────────────────────────────────────────
  ymaps.ready(function () {
    log('Yandex Maps ready');
    try {
      map = new ymaps.Map('map', {
        center: [${initCenter.latitude}, ${initCenter.longitude}],
        zoom: ${zoom},
        controls: ['zoomControl']
      }, { suppressMapOpenBlock: true });

      ${pickupMarkerCode}
      ${dropoffMarkerCode}

      // ── message bus from React Native ──────────────────────────────────
      var processMessage = function(data) {
        try {
          // ── updateDriver ──────────────────────────────────────────────
          if (data.type === 'updateDriver' && map) {
            var coords   = [data.lat, data.lng];
            var heading  = (typeof data.heading === 'number') ? data.heading : null;

            // Fallback: compute heading from last position if GPS has no compass
            if (heading === null && lastDriverCoords) {
              heading = bearing(lastDriverCoords[0], lastDriverCoords[1], data.lat, data.lng);
            }
            lastDriverCoords = coords;

            if (driverPlacemark) {
              // Smooth move — just update coordinates & rotation
              driverPlacemark.geometry.setCoordinates(coords);
              if (heading !== null) {
                driverPlacemark.options.set('iconRotate', heading);
              }
            } else {
              // First time — create the car placemark
              driverPlacemark = new ymaps.Placemark(
                coords,
                {},
                {
                  iconLayout:      'default#image',
                  iconImageHref:   CAR_ICON,
                  iconImageSize:   [40, 40],
                  iconImageOffset: [-20, -20],
                  iconRotate:      heading || 0,
                }
              );
              map.geoObjects.add(driverPlacemark);
            }

            // Auto-follow
            if (data.autoFollow) {
              map.setCenter(coords, undefined, { duration: 400 });
            }
          }

          // ── centerOnDriver ────────────────────────────────────────────
          if (data.type === 'centerOnDriver' && driverPlacemark) {
            map.setCenter(
              driverPlacemark.geometry.getCoordinates(),
              15,
              { duration: 400 }
            );
          }

          // ── buildRoute ───────────────────────────────────────────────
          if (data.type === 'buildRoute' && map) {
            // Remove previous route first
            if (currentRoute) {
              map.geoObjects.remove(currentRoute);
              currentRoute = null;
            }

            var from = [data.fromLat, data.fromLng];
            var to   = [data.toLat,   data.toLng];

            ymaps.route(
              [from, to],
              { routingMode: 'auto', mapStateAutoApply: false }
            ).then(function(route) {
              currentRoute = route;

              // Style every path segment
              route.getPaths().each(function(path) {
                path.options.set({
                  strokeColor:   '#FFD000',
                  strokeWidth:   6,
                  strokeOpacity: 0.9,
                });
              });

              // Hide route markers (start/end dots) to avoid clutter
              route.getWayPoints().options.set('visible', false);

              map.geoObjects.add(route);

              if (data.fitBounds) {
                var bounds = route.getBoundingBox();
                if (bounds) {
                  map.setBounds(bounds, {
                    checkZoomRange: true,
                    zoomMargin: [60, 40, 60, 40],
                  });
                }
              }

              log('Route built');
            }).catch(function(err) {
              log('Route error: ' + err);
            });
          }

          // ── clearRoute ───────────────────────────────────────────────
          if (data.type === 'clearRoute' && currentRoute) {
            map.geoObjects.remove(currentRoute);
            currentRoute = null;
            log('Route cleared');
          }

        } catch(e) { log('processMessage error: ' + e.message); }
      };

      // React Native WebView posts to window.document (Android) or window (iOS)
      document.addEventListener('message', function(e) { processMessage(JSON.parse(e.data)); });
      window.addEventListener('message',   function(e) { processMessage(JSON.parse(e.data)); });

      log('Map init complete');
    } catch(err) { log('Map init error: ' + err.message); }
  });
</script>
</body>
</html>`;
  // HTML is intentionally built once — all live updates go through postMessage.
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
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === "log") {
              console.log("[YandexMap]", data.message);
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
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
