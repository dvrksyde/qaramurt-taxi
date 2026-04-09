import { useRef, useMemo, useCallback, useEffect } from "react";
import { ActivityIndicator, StyleSheet, View, TouchableOpacity } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";

interface Point {
  latitude: number;
  longitude: number;
}

interface Props {
  center?: Point | null;
  userLocation?: Point | null;
  pickupLocation?: Point | null;
  dropoffLocation?: Point | null;
  zoom?: number;
  showCenterButton?: boolean;
}

export function YandexMapView({
  center,
  userLocation,
  pickupLocation,
  dropoffLocation,
  zoom = 15,
  showCenterButton = true,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  // Store initial center only once — prevent HTML regeneration on GPS updates
  const initialCenterRef = useRef<Point | null>(null);
  if (!initialCenterRef.current) {
    initialCenterRef.current = center || userLocation || pickupLocation || dropoffLocation || {
      latitude: 42.3417,
      longitude: 69.5901,
    };
  }

  // Stable refs to avoid re-creating HTML when these change
  const pickupRef = useRef(pickupLocation);
  const dropoffRef = useRef(dropoffLocation);
  pickupRef.current = pickupLocation;
  dropoffRef.current = dropoffLocation;

  // HTML is generated ONCE — never changes after initial render
  const html = useMemo(() => {
    const initCenter = initialCenterRef.current!;
    const pickup = pickupRef.current;
    const dropoff = dropoffRef.current;

    const markersInit: string[] = [];

    if (pickup) {
      markersInit.push(`
        window.pickupPlacemark = new ymaps.Placemark(
          [${pickup.latitude}, ${pickup.longitude}],
          { balloonContentHeader: 'Подача' },
          { preset: 'islands#greenCircleDotIcon' }
        );
        map.geoObjects.add(window.pickupPlacemark);
      `);
    }

    if (dropoff) {
      markersInit.push(`
        window.dropoffPlacemark = new ymaps.Placemark(
          [${dropoff.latitude}, ${dropoff.longitude}],
          { balloonContentHeader: 'Назначение' },
          { preset: 'islands#blueCircleDotIcon' }
        );
        map.geoObjects.add(window.dropoffPlacemark);
      `);
    }

    const driverSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="%23c8440a" stroke="%23fff" stroke-width="3"/><text x="16" y="21" font-size="16" text-anchor="middle" fill="white">🚗</text></svg>';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <style>
            html, body, #map {
              margin: 0;
              padding: 0;
              width: 100%;
              height: 100%;
              background: #1a1a2e;
              overflow: hidden;
            }
            [class*="copyrights-pane"],
            [class*="copyright"] {
              display: none !important;
            }
          </style>
          <script src="https://api-maps.yandex.ru/2.1/?lang=ru_RU"></script>
        </head>
        <body>
          <div id="map"></div>
          <script>
            var driverSvgHref = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('${driverSvg}');

            ymaps.ready(function () {
              window.map = new ymaps.Map('map', {
                center: [${initCenter.latitude}, ${initCenter.longitude}],
                zoom: ${zoom},
                controls: ['zoomControl']
              }, {
                suppressMapOpenBlock: true
              });

              ${markersInit.join("\n")}

              // Listen for messages from React Native
              window.addEventListener('message', function(event) {
                try {
                  var data = JSON.parse(event.data);
                  if (data.type === 'updateDriver' && window.map) {
                    var coords = [data.lat, data.lng];
                    if (window.driverPlacemark) {
                      window.driverPlacemark.geometry.setCoordinates(coords);
                    } else {
                      window.driverPlacemark = new ymaps.Placemark(
                        coords,
                        { balloonContentHeader: 'Водитель' },
                        {
                          iconLayout: 'default#image',
                          iconImageHref: driverSvgHref,
                          iconImageSize: [32, 32],
                          iconImageOffset: [-16, -16]
                        }
                      );
                      window.map.geoObjects.add(window.driverPlacemark);
                    }
                  }
                  if (data.type === 'centerOnDriver' && window.driverPlacemark) {
                    window.map.setCenter(window.driverPlacemark.geometry.getCoordinates(), undefined, { duration: 300 });
                  }
                } catch(e) {}
              });
            });
          </script>
        </body>
      </html>
    `;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps — HTML is built ONCE

  // Update driver position via postMessage (no WebView re-render)
  useEffect(() => {
    if (userLocation && webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: "updateDriver",
          lat: userLocation.latitude,
          lng: userLocation.longitude,
        })
      );
    }
  }, [userLocation]);

  const centerOnMe = useCallback(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({ type: "centerOnDriver" }));
    }
  }, []);

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
        renderLoading={() => (
          <View style={styles.loader}>
            <ActivityIndicator color="#c8440a" />
          </View>
        )}
      />
      {showCenterButton && (
        <TouchableOpacity style={styles.centerBtn} onPress={centerOnMe} activeOpacity={0.7}>
          <Ionicons name="locate" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  webview: { flex: 1, backgroundColor: "transparent" },
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(26,26,46,0.85)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
});
