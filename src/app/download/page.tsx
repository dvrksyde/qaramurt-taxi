import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Скачать приложение — Qaramurt Taxi",
  description: "Скачайте приложение для водителей Qaramurt Taxi на Android",
};

const APK_URL = process.env.APK_DOWNLOAD_URL || "https://drive.google.com/file/d/1Boh7UlV58nqo1lrw3NqTmt5xko1Vk3c_/view?usp=sharing";
const APP_VERSION = process.env.APK_VERSION || "1.3.3";

export default function DownloadPage() {
  return (
    <div style={{ margin: 0, fontFamily: "Inter, sans-serif", background: "#0f0f0f", color: "#fff", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", padding: "40px 24px", maxWidth: 480, width: "100%" }}>

        {/* Logo */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            width: 96, height: 96, borderRadius: 22, background: "linear-gradient(135deg, #FFD700, #FFA500)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 48, margin: "0 auto 16px",
            boxShadow: "0 8px 32px rgba(255, 165, 0, 0.4)"
          }}>
            🚗
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 28, fontWeight: 800, background: "linear-gradient(135deg, #FFD700, #FFA500)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Qaramurt Taxi
          </h1>
          <p style={{ margin: 0, color: "#888", fontSize: 14 }}>Приложение для водителей</p>
        </div>

        {/* App info */}
        <div style={{ background: "#1a1a1a", borderRadius: 16, padding: 24, marginBottom: 24, border: "1px solid #333" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 13, color: "#666" }}>
            <span>Версия</span>
            <span style={{ color: "#fff", fontWeight: 600 }}>v{APP_VERSION}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 13, color: "#666" }}>
            <span>Платформа</span>
            <span style={{ color: "#fff", fontWeight: 600 }}>Android</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#666" }}>
            <span>Требует</span>
            <span style={{ color: "#fff", fontWeight: 600 }}>Android 10+</span>
          </div>
        </div>

        {/* Download button */}
        <a
          href={APK_URL}
          style={{
            display: "block", width: "100%", padding: "18px 0",
            background: APK_URL === "#" ? "#333" : "linear-gradient(135deg, #25D366, #128C7E)",
            color: "#fff", textDecoration: "none", borderRadius: 14,
            fontSize: 17, fontWeight: 700, marginBottom: 16,
            boxShadow: APK_URL === "#" ? "none" : "0 4px 24px rgba(37,211,102,0.35)",
            cursor: APK_URL === "#" ? "not-allowed" : "pointer",
            textAlign: "center",
          }}
        >
          {APK_URL === "#" ? "⏳ Скоро доступно" : "⬇️ Скачать APK"}
        </a>

        {/* Install instructions */}
        <div style={{ background: "#1a1a1a", borderRadius: 12, padding: 16, marginBottom: 24, border: "1px solid #333", textAlign: "left" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#FFD700", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
            Как установить
          </div>
          {[
            "Нажмите «Скачать APK»",
            'Разрешите установку из неизвестных источников',
            "Откройте скачанный файл",
            "Нажмите «Установить»",
            "Войдите с выданным вам логином и паролем",
            "Дайте разрешение на геолокацию",
            "Разрешите уведомления",
          ].map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 13, color: "#ccc", alignItems: "flex-start" }}>
              <span style={{ background: "#FFD700", color: "#000", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {i + 1}
              </span>
              {step}
            </div>
          ))}
        </div>

        <p style={{ color: "#444", fontSize: 12, margin: 0 }}>
          © {new Date().getFullYear()} Qaramurt Taxi. v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}
