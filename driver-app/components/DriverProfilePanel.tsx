import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, clearToken } from "../services/api";
import { disconnectSocket } from "../services/socket";
import { useDriverStore } from "../stores/driverStore";

export function DriverProfilePanel() {
  const router = useRouter();
  const { profile, setProfile, setOnline } = useDriverStore();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const fillForm = (nextProfile: any) => {
    setFirstName(nextProfile?.firstName || "");
    setLastName(nextProfile?.lastName || "");
    setMiddleName(nextProfile?.middleName || "");
    setPhone(nextProfile?.phone || "");
  };

  useEffect(() => {
    if (profile) fillForm(profile);
  }, [profile]);

  const saveProfile = async () => {
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      Alert.alert("Ошибка", "Имя, фамилия и номер обязательны");
      return;
    }

    setSaving(true);
    const res = await api("/api/driver/profile", {
      method: "PATCH",
      body: JSON.stringify({ firstName, lastName, middleName, phone, password }),
    });
    setSaving(false);

    if (res.error) {
      Alert.alert("Ошибка", res.error);
      return;
    }

    if (res.data) {
      setProfile(res.data);
      setPassword("");
      Alert.alert("Готово", "Профиль обновлен");
    }
  };

  const logout = async () => {
    disconnectSocket();
    await clearToken();
    setProfile(null);
    setOnline(false);
    router.replace("/login");
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Профиль</Text>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryName}>{profile?.lastName} {profile?.firstName}</Text>
          <Text style={styles.summaryMeta}>Логин: {profile?.login}</Text>
          <Text style={styles.summaryMeta}>Позывной: {profile?.callsign || "—"}</Text>
          <Text style={styles.summaryMeta}>Рейтинг: #{Number(profile?.rating || 0)}</Text>
          <Text style={styles.summaryMeta}>Выполнено заказов: {Number((profile as any)?.ordersCount || 0)}</Text>
          <Text style={styles.summaryMeta}>Баланс: {Number(profile?.balance || 0).toLocaleString()} ₸</Text>

          <View style={styles.tariffBox}>
            <Text style={styles.tariffTitle}>Текущий тариф</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.tariffName}>
                {profile?.tariffGroup ? `${profile.tariffGroup.name} (${Number(profile.tariffGroup.value)}%)` : "Не назначен"}
              </Text>
            </View>
            <Text style={styles.tariffNote}>Чтобы изменить тариф, свяжитесь с диспетчером</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.label}>Имя</Text>
          <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} placeholder="Имя" placeholderTextColor="#666" />

          <Text style={styles.label}>Фамилия</Text>
          <TextInput style={styles.input} value={lastName} onChangeText={setLastName} placeholder="Фамилия" placeholderTextColor="#666" />

          <Text style={styles.label}>Отчество</Text>
          <TextInput style={styles.input} value={middleName} onChangeText={setMiddleName} placeholder="Отчество" placeholderTextColor="#666" />

          <Text style={styles.label}>Номер телефона</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+7..." placeholderTextColor="#666" keyboardType="phone-pad" />

          <Text style={styles.label}>Новый пароль</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Оставьте пустым, если менять не нужно"
            placeholderTextColor="#666"
            secureTextEntry
          />

          <TouchableOpacity style={styles.saveBtn} onPress={saveProfile} disabled={saving}>
            <Ionicons name="save-outline" size={20} color="#000" />
            <Text style={styles.saveBtnText}>{saving ? "..." : "Сохранить профиль"}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color="#ef4444" />
          <Text style={styles.logoutBtnText}>Выйти из аккаунта</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 16 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: 0.5 },
  summaryCard: { backgroundColor: "#111", borderRadius: 16, padding: 20, gap: 8, borderWidth: 1, borderColor: "#1e1e1e" },
  summaryName: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 4 },
  summaryMeta: { color: "#aaa", fontSize: 15, fontWeight: "500" },
  tariffBox: { marginTop: 12, padding: 16, backgroundColor: "#161616", borderRadius: 12, borderWidth: 1, borderColor: "#222" },
  tariffTitle: { color: "#919191ff", fontSize: 12, marginBottom: 6, fontWeight: "700", textTransform: "uppercase" },
  tariffName: { color: "#FFD000", fontSize: 18, fontWeight: "800" },
  tariffNote: { color: "#919191ff", fontSize: 12, marginTop: 8, fontStyle: "italic" },
  formCard: { backgroundColor: "#111", borderRadius: 16, padding: 20, borderWidth: 1, borderColor: "#1e1e1e" },
  label: { color: "#888", fontSize: 13, marginBottom: 8, marginTop: 12, fontWeight: "600", textTransform: "uppercase" },
  input: { backgroundColor: "#161616", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: "#fff", fontSize: 16, borderWidth: 1, borderColor: "#2a2a2a" },
  saveBtn: {
    marginTop: 24,
    height: 56,
    borderRadius: 14,
    backgroundColor: "#FFD000",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  saveBtnText: { color: "#000", fontSize: 16, fontWeight: "800" },
  logoutBtn: {
    height: 56,
    borderRadius: 14,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.5)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoutBtnText: { color: "#ef4444", fontSize: 16, fontWeight: "700" },
});
