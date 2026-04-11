import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getSocket } from "../services/socket";
import { api } from "../services/api";
import { useDriverStore } from "../stores/driverStore";

interface Message {
  id: string;
  from: string;
  text: string;
  timestamp: string;
  direction: "inbound" | "outbound";
}

export function DriverChatPanel() {
  const profile = useDriverStore((s) => s.profile);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const normalizeMessage = useCallback((msg: any): Message => ({
    id: String(msg.id ?? `${msg.timestamp || Date.now()}-${msg.from || "dispatcher"}-${msg.text || ""}`),
    from: msg.from || "Диспетчер",
    text: msg.text || "",
    timestamp: msg.timestamp || new Date().toISOString(),
    direction: msg.direction === "outbound" ? "outbound" : "inbound",
  }), []);

  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((prev) => {
      const map = new Map<string, Message>();
      [...prev, ...incoming].forEach((message) => {
        map.set(message.id, message);
      });
      return Array.from(map.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    });
  }, []);

  const loadMessages = useCallback(async () => {
    const res = await api("/api/chat");
    if (Array.isArray(res.data)) {
      mergeMessages(res.data.map(normalizeMessage));
    }
  }, [mergeMessages, normalizeMessage]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handler = (msg: any) => {
      if (msg.driverId && msg.driverId !== profile?.id) return;
      mergeMessages([normalizeMessage(msg)]);
    };

    socket.on("chat_message", handler);
    return () => {
      socket.off("chat_message", handler);
    };
  }, [mergeMessages, normalizeMessage, profile?.id]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const sendMessage = () => {
    if (!text.trim()) return;
    const socket = getSocket();
    if (!socket || !profile) return;

    const msg = {
      from: `driver:${profile.id}`,
      driverId: profile.id,
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };

    socket.emit("chat_message", msg);
    mergeMessages([normalizeMessage({ ...msg, direction: "outbound" })]);
    setText("");
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[styles.bubble, item.direction === "outbound" ? styles.bubbleOut : styles.bubbleIn]}>
      {item.direction === "inbound" && <Text style={styles.bubbleFrom}>{item.from}</Text>}
      <Text style={[styles.bubbleText, item.direction === "outbound" && { color: "#000" }]}>{item.text}</Text>
      <Text style={[styles.bubbleTime, item.direction === "outbound" && { color: "rgba(0,0,0,0.5)" }]}>{formatTime(item.timestamp)}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={styles.title}>Чат с диспетчером</Text>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubble-ellipses-outline" size={48} color="#333" />
            <Text style={styles.emptyText}>Нет сообщений</Text>
            <Text style={styles.emptyHint}>Переписка сохраняется автоматически</Text>
          </View>
        }
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Сообщение..."
          placeholderTextColor="#666"
          value={text}
          onChangeText={setText}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <TouchableOpacity style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]} onPress={sendMessage} disabled={!text.trim()}>
          <Ionicons name="send" size={20} color="#000" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800", paddingHorizontal: 16, marginBottom: 16, letterSpacing: 0.5 },
  messageList: { paddingHorizontal: 16, paddingBottom: 8, flexGrow: 1 },
  bubble: { maxWidth: "80%", borderRadius: 16, padding: 14, marginBottom: 10 },
  bubbleIn: { backgroundColor: "#111", alignSelf: "flex-start", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: "#1e1e1e" },
  bubbleOut: { backgroundColor: "#FFD000", alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleFrom: { color: "#888", fontSize: 11, fontWeight: "600", marginBottom: 4, textTransform: "uppercase" },
  bubbleText: { color: "#e0e0e0", fontSize: 16, lineHeight: 22 },
  bubbleTime: { color: "#666", fontSize: 10, alignSelf: "flex-end", marginTop: 6, fontWeight: "500" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, marginTop: 100 },
  emptyText: { color: "#666", fontSize: 16, fontWeight: "600" },
  emptyHint: { color: "#444", fontSize: 13, textAlign: "center" },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#1e1e1e",
    gap: 12,
  },
  input: {
    flex: 1,
    backgroundColor: "#111",
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#222",
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFD000",
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
});
