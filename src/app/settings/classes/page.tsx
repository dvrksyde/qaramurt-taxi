"use client";
import React from "react";

export default function VehicleClassesPage() {
  return (
    <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", backgroundColor: "var(--color-bg)", height: "100%" }}>
      <h2>Классы автомобилей</h2>
      <div className="card" style={{ padding: "24px", color: "var(--color-text-2)" }}>
        <p>Настройка классов (Эконом, Бизнес, Минивэн) и приоритета.</p>
        <p><i>Классы уже инициализированы в базе данных.</i></p>
      </div>
    </div>
  );
}
