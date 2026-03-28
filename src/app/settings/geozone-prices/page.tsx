"use client";
import React from "react";

export default function GeozonePricesPage() {
  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", backgroundColor: "var(--color-bg)", height: "100%" }}>
      <h2>Цены в геозонах</h2>
      <div className="card" style={{ padding: "24px", color: "var(--color-text-2)" }}>
        <p>Настройки матрицы цен между геозонами (e.g., Аэропорт → Центр = 500₽).</p>
        <p><i>Модуль в разработке... Вы можете настроить базовые тарифы в разделе "Службы такси и тарифы".</i></p>
      </div>
    </div>
  );
}
