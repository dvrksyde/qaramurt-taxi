"use client";
import { useMonitorStore } from "@/stores/monitorStore";
import { useSocket } from "@/stores/socketStore";
import { useState, useRef, useEffect } from "react";
import type { Driver } from "@/types";

export function ChatTab() {
  const { chatMessages, setChatMessages, chatHistoryLoaded, clearChatUnread, driverLocations, readChatAt, markDriverChatRead } = useMonitorStore();
  const { sendChatMessage } = useSocket();
  const [text, setText] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState<number | "all" | null>(null);
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load ALL drivers from API (not just online)
  useEffect(() => {
    fetch("/api/drivers?pageSize=500")
      .then((r) => r.json())
      .then((res) => {
        if (res.data) setAllDrivers(res.data);
      })
      .catch(() => {});
  }, []);

  // Load chat history from DB — only once (tracked in store, not component)
  useEffect(() => {
    if (chatHistoryLoaded) return;
    fetch("/api/chat")
      .then((r) => r.json())
      .then((res) => {
        if (res.data) {
          setChatMessages(
            res.data.map((msg: any) => ({
              from: msg.from,
              driverId: msg.driverId,
              text: msg.text,
              timestamp: msg.timestamp,
              direction: msg.direction,
            }))
          );
        }
      })
      .catch(() => {});
  }, [chatHistoryLoaded]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  // When selecting a driver, mark their messages as read
  const selectDriver = (id: number | "all") => {
    setSelectedDriverId(id);
    if (typeof id === "number") {
      markDriverChatRead(id);
    } else {
      clearChatUnread();
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    sendChatMessage(text.trim(), selectedDriverId === "all" ? undefined : selectedDriverId ?? undefined);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") handleSend();
  };

  // Build driver list: ALL drivers, with online status from driverLocations
  const driverList = allDrivers.map((d) => {
    const loc = driverLocations[d.id];
    return {
      driverId: d.id,
      name: `${d.lastName} ${d.firstName}`.trim(),
      callsign: d.callsign || null,
      status: loc?.status || (d.status === "free" || d.status === "busy" ? d.status : "offline"),
    };
  }).sort((a, b) => {
    const statusOrder: Record<string, number> = { free: 0, busy: 1, offline: 2 };
    return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
  });

  // Filter messages for selected driver
  const filteredMessages = selectedDriverId === "all"
    ? chatMessages.filter((m) => !m.driverId && m.direction === "outbound")
    : selectedDriverId
      ? chatMessages.filter((m) => m.driverId === selectedDriverId || (!m.driverId && m.direction === "outbound"))
      : [];

  const statusColor = (status: string) => {
    switch (status) {
      case "free": return "#3db84a";
      case "busy": return "#f5c518";
      case "offline": return "#e84646";
      default: return "#888";
    }
  };

  const getDriverLabel = (driverId: number) => {
    const d = driverList.find((x) => x.driverId === driverId);
    if (!d) return `Водитель #${driverId}`;
    const callsign = d.callsign || "";
    return `${callsign} ${d.name}`.trim();
  };

  const selectedDriverName = selectedDriverId === "all"
    ? "Все водители"
    : selectedDriverId
      ? getDriverLabel(selectedDriverId)
      : null;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* ────── Left panel: driver list ────── */}
      <div style={{
        width: 280,
        flexShrink: 0,
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface)",
        overflowY: "auto",
      }}>
        {/* Broadcast button */}
        <button
          onClick={() => selectDriver("all")}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            border: "none",
            borderBottom: "1px solid var(--color-border)",
            background: selectedDriverId === "all" ? "#fff3e0" : "transparent",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 13,
            color: "#c8440a",
          }}
        >
          Написать всем водителям
        </button>

        {/* Driver entries */}
        {driverList.map((driver) => {
          const unreadCount = chatMessages.filter(
            (m) => {
              if (m.driverId !== driver.driverId || m.direction !== "inbound") return false;
              const readTime = readChatAt[driver.driverId];
              if (!readTime) return true;
              return new Date(m.timestamp) > new Date(readTime);
            }
          ).length;

          const label = getDriverLabel(driver.driverId);

          return (
            <div
              key={driver.driverId}
              onClick={() => selectDriver(driver.driverId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                cursor: "pointer",
                borderBottom: "1px solid var(--color-border)",
                background: selectedDriverId === driver.driverId ? "#fff3e0" : "transparent",
                fontSize: 12,
                fontWeight: selectedDriverId === driver.driverId ? 600 : 400,
              }}
            >
              <span style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: statusColor(driver.status),
                flexShrink: 0,
              }} />
              <span style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textTransform: "uppercase",
              }}>
                {label}
              </span>
              {unreadCount > 0 && (
                <span style={{
                  background: "#e84646",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "1px 6px",
                  fontSize: 10,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {unreadCount}
                </span>
              )}
            </div>
          );
        })}

        {driverList.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#999", fontSize: 12 }}>
            Загрузка водителей...
          </div>
        )}
      </div>

      {/* ────── Right panel: messages ────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {selectedDriverId === null ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "#999", fontSize: 14, background: "#f5f5f0",
          }}>
            Выберите водителя для начала переписки
          </div>
        ) : (
          <>
            <div style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--color-border)",
              fontWeight: 700, fontSize: 13,
              background: "var(--color-surface)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              {selectedDriverId !== "all" && (
                <span style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: statusColor(
                    driverList.find(d => d.driverId === selectedDriverId)?.status || "offline"
                  ),
                }} />
              )}
              {selectedDriverName}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 10, background: "#f0f0ea" }}>
              {filteredMessages.length === 0 ? (
                <div style={{ textAlign: "center", color: "#999", marginTop: 40, fontSize: 13 }}>
                  Нет сообщений
                </div>
              ) : (
                filteredMessages.map((msg, i) => (
                  <div key={i} style={{
                    marginBottom: 8, display: "flex",
                    flexDirection: msg.direction === "outbound" ? "row-reverse" : "row", gap: 8,
                  }}>
                    <div style={{
                      background: msg.direction === "outbound" ? "#c8440a" : "#fff",
                      color: msg.direction === "outbound" ? "#fff" : "#1a1a18",
                      borderRadius: 8, padding: "6px 10px", maxWidth: "70%",
                      fontSize: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 2, opacity: 0.8 }}>
                        {msg.direction === "inbound" && msg.driverId
                          ? getDriverLabel(msg.driverId)
                          : msg.from}
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

            <div style={{
              borderTop: "1px solid var(--color-border)",
              padding: "8px 10px", display: "flex", gap: 8,
              flexShrink: 0, background: "var(--color-surface)",
            }}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                className="form-textarea"
                style={{ flex: 1, minHeight: 36, maxHeight: 80, resize: "none" }}
                placeholder="Сообщение..."
                rows={1}
              />
              <button className="btn btn-primary" onClick={handleSend} style={{ whiteSpace: "nowrap" }}>
                Отправить<br />
                <span style={{ fontSize: 10, opacity: 0.7 }}>(Ctrl+Enter)</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
