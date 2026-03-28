"use client";
import { useMonitorStore } from "@/stores/monitorStore";
import { useSocket } from "@/stores/socketStore";
import { useState, useRef, useEffect } from "react";

export function ChatTab() {
  const { chatMessages, clearChatUnread } = useMonitorStore();
  const { sendChatMessage } = useSocket();
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    clearChatUnread();
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSend = () => {
    if (!text.trim()) return;
    sendChatMessage(text.trim());
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") handleSend();
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
        {chatMessages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <div>Нет сообщений чата</div>
          </div>
        ) : (
          chatMessages.map((msg, i) => (
            <div
              key={i}
              style={{
                marginBottom: 8,
                display: "flex",
                flexDirection: msg.direction === "outbound" ? "row-reverse" : "row",
                gap: 8,
              }}
            >
              <div style={{
                background: msg.direction === "outbound" ? "#c8440a" : "#f0f0ea",
                color: msg.direction === "outbound" ? "#fff" : "#1a1a18",
                borderRadius: 8,
                padding: "6px 10px",
                maxWidth: "70%",
                fontSize: 12,
              }}>
                <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 2, opacity: 0.8 }}>
                  {msg.from}
                  {msg.driverId ? ` (Водитель #${msg.driverId})` : ""}
                </div>
                <div>{msg.text}</div>
                <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
                  {new Date(msg.timestamp).toLocaleTimeString("ru")}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        borderTop: "1px solid var(--color-border)",
        padding: "8px 10px",
        display: "flex",
        gap: 8,
        flexShrink: 0,
        background: "var(--color-surface)",
      }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="form-textarea"
          style={{ flex: 1, minHeight: 36, maxHeight: 80, resize: "none" }}
          placeholder="Сообщение... (Ctrl+Enter — отправить)"
          rows={1}
        />
        <button className="btn btn-primary" onClick={handleSend}>
          Отправить
        </button>
      </div>
    </div>
  );
}
