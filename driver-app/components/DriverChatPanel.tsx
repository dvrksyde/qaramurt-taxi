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
      <Text style={styles.bubbleText}>{item.text}</Text>
      <Text style={styles.bubbleTime}>{formatTime(item.timestamp)}</Text>
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
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", paddingHorizontal: 20, marginBottom: 12 },
  messageList: { paddingHorizontal: 16, paddingBottom: 8, flexGrow: 1 },
  bubble: { maxWidth: "80%", borderRadius: 16, padding: 12, marginBottom: 8 },
  bubbleIn: { backgroundColor: "#252540", alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  bubbleOut: { backgroundColor: "#c8440a", alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleFrom: { color: "#cfd3ff", fontSize: 11, fontWeight: "600", marginBottom: 2 },
  bubbleText: { color: "#fff", fontSize: 15, lineHeight: 20 },
  bubbleTime: { color: "rgba(255,255,255,0.5)", fontSize: 10, alignSelf: "flex-end", marginTop: 4 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8, marginTop: 100 },
  emptyText: { color: "#666", fontSize: 16 },
  emptyHint: { color: "#444", fontSize: 13 },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#252540",
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: "#252540",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#c8440a",
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
});
