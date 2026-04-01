import { useEffect, useState, useRef } from "react";
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { getSocket } from "../services/socket";
import { useDriverStore } from "../stores/driverStore";

interface Message {
  id: string;
  from: string;
  text: string;
  timestamp: string;
  direction: "inbound" | "outbound";
}

export default function ChatScreen() {
  const router = useRouter();
  const profile = useDriverStore((s) => s.profile);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handler = (msg: any) => {
      // Only show messages for this driver
      if (msg.driverId && msg.driverId !== profile?.id) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          from: msg.from || "Диспетчер",
          text: msg.text,
          timestamp: msg.timestamp || new Date().toISOString(),
          direction: msg.from === `driver:${profile?.id}` ? "outbound" : "inbound",
        },
      ]);
    };

    socket.on("chat_message", handler);
    return () => {
      socket.off("chat_message", handler);
    };
  }, [profile?.id]);

  useEffect(() => {
    // Auto-scroll to bottom
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

    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}`,
        from: msg.from,
        text: msg.text,
        timestamp: msg.timestamp,
        direction: "outbound",
      },
    ]);
    setText("");
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[
      styles.bubble,
      item.direction === "outbound" ? styles.bubbleOut : styles.bubbleIn,
    ]}>
      {item.direction === "inbound" && (
        <Text style={styles.bubbleFrom}>Диспетчер</Text>
      )}
      <Text style={styles.bubbleText}>{item.text}</Text>
      <Text style={styles.bubbleTime}>{formatTime(item.timestamp)}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>💬 Чат с диспетчером</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Messages */}
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
            <Text style={styles.emptyHint}>Напишите диспетчеру, если нужна помощь</Text>
          </View>
        }
      />

      {/* Input */}
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
        <TouchableOpacity
          style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!text.trim()}
        >
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", paddingTop: 50 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 8 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },

  messageList: { paddingHorizontal: 16, paddingBottom: 8, flexGrow: 1 },

  bubble: { maxWidth: "80%", borderRadius: 16, padding: 12, marginBottom: 8 },
  bubbleIn: { backgroundColor: "#252540", alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  bubbleOut: { backgroundColor: "#c8440a", alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleFrom: { color: "#c8440a", fontSize: 11, fontWeight: "600", marginBottom: 2 },
  bubbleText: { color: "#fff", fontSize: 15, lineHeight: 20 },
  bubbleTime: { color: "rgba(255,255,255,0.5)", fontSize: 10, alignSelf: "flex-end", marginTop: 4 },

  empty: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8, marginTop: 100 },
  emptyText: { color: "#666", fontSize: 16 },
  emptyHint: { color: "#444", fontSize: 13 },

  inputBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#252540", gap: 8 },
  input: { flex: 1, backgroundColor: "#252540", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: "#fff", fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#c8440a", justifyContent: "center", alignItems: "center" },
  sendBtnDisabled: { opacity: 0.4 },
});
