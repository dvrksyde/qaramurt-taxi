import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, Image, Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { api, saveToken } from "../services/api";
import { useDriverStore } from "../stores/driverStore";
import { Ionicons } from "@expo/vector-icons";
import * as Device from "expo-device";

// Known competing taxi apps — detect by URI scheme
const TAXI_APPS = [
  { id: "yandex_pro",   name: "Яндекс Про",      scheme: "yandexpro://"     },
  { id: "indrive",      name: "inDrive",         scheme: "indrive://"       },
  { id: "taxomet",      name: "Таксомет",        scheme: "taxomet://"       },
  { id: "salam_taxi",   name: "SalamTaxi",       scheme: "salamtaxi://"     },
  { id: "yandex_taxi",  name: "Яндекс Такси",  scheme: "yandextaxi://"    },
  { id: "uber_driver",  name: "Uber Driver",     scheme: "uberdriver://"    },
  { id: "maxim",        name: "Maxim",           scheme: "taxsee://"        },
];

async function detectInstalledTaxiApps(): Promise<string[]> {
  const found: string[] = [];
  for (const app of TAXI_APPS) {
    try {
      const can = await Linking.canOpenURL(app.scheme);
      if (can) found.push(app.id);
    } catch {}
  }
  return found;
}

export default function LoginScreen() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const router = useRouter();
  const setProfile = useDriverStore((s) => s.setProfile);

  const handleLogin = async () => {
    if (!login.trim() || !password.trim()) {
      Alert.alert("Ошибка", "Введите логин и пароль");
      return;
    }

    setLoading(true);
    const res = await api("/api/driver/auth", {
      method: "POST",
      body: JSON.stringify({ login: login.trim(), password: password.trim() }),
    });
    setLoading(false);

    if (res.error) {
      Alert.alert("Ошибка", res.error);
      return;
    }

    await saveToken(res.data.token);
    setProfile(res.data.driver);

    // Detect installed competitor apps and device info
    const osVer = `${Device.osName} ${Device.osVersion}`;
    detectInstalledTaxiApps().then((apps) => {
      api("/api/driver/profile/apps", {
        method: "POST",
        body: JSON.stringify({ 
          apps,
          osVersion: osVer,
          deviceId: Device.modelName || Device.deviceName
        }),
      }).catch(() => {});
    });

    router.replace("/");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.logoContainer}>
        <Image
          source={require("../assets/icon.png")}
          style={styles.logoImg}
          resizeMode="contain"
        />
        <Text style={styles.title}>Qaramurt Taxi</Text>
        <Text style={styles.subtitle}>Приложение водителя</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputContainer}>
          <Ionicons name="person-outline" size={20} color="#666" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Логин"
            placeholderTextColor="#666"
            value={login}
            onChangeText={setLogin}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputContainer}>
          <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Пароль"
            placeholderTextColor="#666"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPass}
          />
          <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.eyeBtn}>
            <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={20} color="#666" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.loginBtnText}>
            {loading ? "Вход..." : "ВОЙТИ"}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>Qaramurt Taxi ©2026</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 48,
  },
  logoImg: {
    width: 110,
    height: 110,
    borderRadius: 22,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: "#888",
    marginTop: 4,
  },
  form: {
    gap: 16,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#222",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
    paddingHorizontal: 16,
    height: 52,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
  },
  eyeBtn: {
    padding: 4,
  },
  loginBtn: {
    backgroundColor: "#FFD000",
    borderRadius: 12,
    height: 52,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  loginBtnText: {
    color: "#000000ff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1,
  },
  footer: {
    color: "#444",
    textAlign: "center",
    fontSize: 12,
    marginTop: 48,
  },
});
