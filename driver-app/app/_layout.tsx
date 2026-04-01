import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { loadToken, getToken } from "../services/api";
import { View, ActivityIndicator } from "react-native";

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    loadToken().then((t) => {
      setAuthenticated(!!t);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;

    const inAuthGroup = segments[0] === "login";

    if (!authenticated && !inAuthGroup) {
      router.replace("/login");
    } else if (authenticated && inAuthGroup) {
      router.replace("/");
    }
  }, [ready, authenticated, segments]);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#1a1a2e" }}>
        <ActivityIndicator size="large" color="#c8440a" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#1a1a2e" },
          animation: "fade",
        }}
      />
    </>
  );
}
