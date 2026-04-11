import { useEffect, useState, useCallback } from "react";
import { Stack, useRouter, useSegments, SplashScreen } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { loadToken, getToken } from "../services/api";
import { View, ActivityIndicator } from "react-native";

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    loadToken().then(() => {
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;

    const token = getToken();
    const inAuthGroup = segments[0] === "login";

    if (!token && !inAuthGroup) {
      router.replace("/login");
    } else if (token && inAuthGroup) {
      router.replace("/");
    }
  }, [ready]);  // Only run once when ready, not on every segment change

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#222222ff" }}>
        <ActivityIndicator size="large" color="#FFD000" />
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
