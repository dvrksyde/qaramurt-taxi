"use client";

export function SystemTab() {
  return (
    <div className="empty-state" style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      <div className="empty-state-icon" style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
      <div style={{ fontSize: 24, fontWeight: "bold", color: "var(--color-primary)" }}>Coming Soon...</div>
      <div style={{ color: "#888", marginTop: 8 }}>В будущем мы сами изменим логику этой страницы</div>
    </div>
  );
}

