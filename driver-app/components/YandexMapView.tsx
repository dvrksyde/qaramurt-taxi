import React, { useRef, useMemo, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
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

export type YandexMapViewHandle = {
  centerOnMe: () => void;
};

export const YandexMapView = forwardRef<YandexMapViewHandle, Props>((
  {
    center,
    userLocation,
    pickupLocation,
    dropoffLocation,
    zoom = 15,
    showCenterButton = true,
  },
  ref
) => {
  const webViewRef = useRef<WebView>(null);
  const initialCenterRef = useRef<Point | null>(null);

  if (!initialCenterRef.current) {
    initialCenterRef.current = center || userLocation || pickupLocation || dropoffLocation || {
      latitude: 42.3417,
      longitude: 69.5901,
    };
  }

  const pickupRef = useRef(pickupLocation);
  const dropoffRef = useRef(dropoffLocation);
  pickupRef.current = pickupLocation;
  dropoffRef.current = dropoffLocation;

  const centerOnMe = useCallback(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({ type: "centerOnDriver" }));
    }
  }, []);

  useImperativeHandle(ref, () => ({
    centerOnMe
  }));

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

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <style>
            html, body, #map {
              margin: 0; padding: 0; width: 100%; height: 100%;
              background: #1a1a2e; overflow: hidden;
            }
            [class*="copyrights-pane"], [class*="copyright"] {
              display: none !important;
            }
          </style>
          <script src="https://api-maps.yandex.ru/2.1/?lang=ru_RU"></script>
        </head>
        <body>
          <div id="map"></div>
          <script>
            // Debug logging to React Native
            function log(msg) {
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: msg }));
              }
            }

            window.onerror = function(msg) { log('JS Error: ' + msg); };

            ymaps.ready(function () {
              log('Yandex Maps Ready');
              try {
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
                          { balloonContentHeader: 'Вы' },
                          { preset: 'islands#redCircleDotIcon' }
                        );
                        window.map.geoObjects.add(window.driverPlacemark);
                      }
                    }
                    if (data.type === 'centerOnDriver' && window.driverPlacemark) {
                      window.map.setCenter(window.driverPlacemark.geometry.getCoordinates(), undefined, { duration: 300 });
                    }
                  } catch(e) { log('Process Message Error: ' + e.message); }
                });
              } catch(err) { log('Map Init Error: ' + err.message); }
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
              console.log("[WebView Log]", data.message);
            }
          } catch (e) {}
        }}
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
});

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
