import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { loadToken, getToken, API_BASE } from "../services/api";
import { View, ActivityIndicator, Text, TouchableOpacity, Linking, StyleSheet } from "react-native";
import Constants from "expo-constants";

const APP_VERSION: string = Constants.expoConfig?.version ?? "0.0.0";

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [minVersion, setMinVersion] = useState<string>("—");
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    const init = async () => {
      await loadToken();

      try {
        const res = await fetch(`${API_BASE}/api/app/version`);
        const data = await res.json();
        const min: string = data.minVersion ?? "1.0.0";
        setMinVersion(min);
        setDownloadUrl(data.downloadUrl ?? null);

        if (compareVersions(APP_VERSION, min) < 0) {
          setForceUpdate(true);
          setReady(true);
          return;
        }
      } catch {
        // Сервер недоступен — не блокируем, пускаем дальше
      }

      setReady(true);
    };

    init();
  }, []);

  useEffect(() => {
    if (!ready || forceUpdate) return;

    const token = getToken();
    const inAuthGroup = segments[0] === "login";

    if (!token && !inAuthGroup) {
      router.replace("/login");
    } else if (token && inAuthGroup) {
      router.replace("/");
    }
  }, [ready, forceUpdate]);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FFD000" />
      </View>
    );
  }

  if (forceUpdate) {
    return (
      <View style={styles.center}>
        <Text style={styles.icon}>🚕</Text>
        <Text style={styles.title}>Требуется обновление</Text>
        <Text style={styles.subtitle}>
          Ваша версия приложения устарела.{"\n"}
          Пожалуйста, установите новую версию.
        </Text>
        <View style={styles.versionRow}>
          <Text style={styles.versionLabel}>Ваша версия:</Text>
          <Text style={styles.versionOld}>{APP_VERSION}</Text>
        </View>
        <View style={styles.versionRow}>
          <Text style={styles.versionLabel}>Требуется:</Text>
          <Text style={styles.versionNew}>{minVersion}</Text>
        </View>
        {downloadUrl ? (
          <TouchableOpacity
            style={styles.btn}
            onPress={() => Linking.openURL(downloadUrl)}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>Скачать обновление</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.contact}>
            Обратитесь к диспетчеру для получения обновления
          </Text>
        )}
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#111" },
          animation: "fade",
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111",
    padding: 32,
  },
  icon: { fontSize: 56, marginBottom: 16 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFD000",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: "#aaa",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  versionRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  versionLabel: { fontSize: 14, color: "#888" },
  versionOld: { fontSize: 14, color: "#ff6b6b", fontWeight: "600" },
  versionNew: { fontSize: 14, color: "#51cf66", fontWeight: "600" },
  btn: {
    marginTop: 28,
    backgroundColor: "#FFD000",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: { fontSize: 16, fontWeight: "700", color: "#111" },
  contact: {
    marginTop: 28,
    fontSize: 14,
    color: "#888",
    textAlign: "center",
    lineHeight: 20,
  },
});
