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
            <View style={{flexDirection: "row", justifyContent: "space-between", alignItems: "center"}}>
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
            <Ionicons name="save-outline" size={20} color="#fff" />
            <Text style={styles.saveBtnText}>{saving ? "..." : "Сохранить"}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={18} color="#fff" />
          <Text style={styles.logoutBtnText}>Выйти из аккаунта</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 12 },
  summaryCard: { backgroundColor: "#252540", borderRadius: 16, padding: 18, gap: 6 },
  summaryName: { color: "#fff", fontSize: 22, fontWeight: "800" },
  summaryMeta: { color: "#b6b9d9", fontSize: 14 },
  tariffBox: { marginTop: 8, padding: 12, backgroundColor: "#1e1f38", borderRadius: 10 },
  tariffTitle: { color: "#888", fontSize: 12, marginBottom: 4 },
  tariffName: { color: "#4CAF50", fontSize: 16, fontWeight: "700" },
  tariffNote: { color: "#b6b9d9", fontSize: 11, marginTop: 6, fontStyle: "italic" },
  formCard: { backgroundColor: "#252540", borderRadius: 16, padding: 18 },
  label: { color: "#b6b9d9", fontSize: 13, marginBottom: 8, marginTop: 10 },
  input: { backgroundColor: "#1e1f38", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontSize: 15 },
  saveBtn: {
    marginTop: 18,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#c8440a",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  logoutBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: "#f44336",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoutBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
