"use client";

import { useEffect, useState } from "react";

interface LeaderboardEntry {
  id: number;
  name: string;
  callsign: string | null;
  ordersCount: number;
  totalEarnings: number;
}

export function LeaderboardTab() {
  const [data, setData] = useState<{ today: LeaderboardEntry[]; week: LeaderboardEntry[] }>({
    today: [],
    week: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/drivers/leaderboard")
      .then((r) => r.json())
      .then((d) => {
        if (d.today && d.week) setData(d);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleExport = () => {
    let csv = "\uFEFF"; // BOM for Excel UTF-8 support
    csv += "Период;Место;Позывной;Имя;Заказы;Доход (₸)\n";

    data.today.forEach((d, i) => {
      csv += `Сегодня;${i + 1};${d.callsign || ""};${d.name};${d.ordersCount};${d.totalEarnings}\n`;
    });
    csv += ";;;;;\n"; // spacer
    data.week.forEach((d, i) => {
      csv += `Неделя;${i + 1};${d.callsign || ""};${d.name};${d.ordersCount};${d.totalEarnings}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Rating_Drivers_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return <div className="p-4"><div className="pulse">Загрузка данных...</div></div>;

  const renderTable = (entries: LeaderboardEntry[], title: string) => (
    <div className="card" style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 16px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h4 style={{ margin: 0, fontSize: 16 }}>🏆 {title}</h4>
      </div>
      <div className="data-table-wrap" style={{ flex: 1 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40, textAlign: "center" }}>№</th>
              <th>Водитель</th>
              <th style={{ textAlign: "center" }}>Заказы</th>
              <th style={{ textAlign: "right" }}>Доход</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={4} align="center" className="text-muted">Нет данных</td></tr>
            ) : entries.map((e, idx) => (
              <tr key={e.id}>
                <td align="center">
                  <span style={{ 
                    display: "inline-block", width: 22, height: 22, lineHeight: "22px", borderRadius: "50%", 
                    background: idx === 0 ? "#ffd700" : idx === 1 ? "#c0c0c0" : idx === 2 ? "#cd7f32" : "transparent",
                    color: idx < 3 ? "#000" : "inherit",
                    fontWeight: idx < 3 ? 700 : 400
                  }}>
                    {idx + 1}
                  </span>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{e.name}</div>
                  <div className="text-muted text-sm">Позывной: {e.callsign || "—"}</div>
                </td>
                <td align="center">
                  <strong style={{ color: "var(--color-primary)" }}>{e.ordersCount}</strong>
                </td>
                <td align="right">
                  <span style={{ fontWeight: 600 }}>{e.totalEarnings.toLocaleString()} ₸</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20, overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>Рейтинг водителей</h2>
          <p className="text-muted" style={{ margin: "4px 0 0" }}>Лучшие по количеству выполненных заказов</p>
        </div>
        <button className="btn btn-primary" onClick={handleExport}>
          📥 Скачать отчет (Excel)
        </button>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {renderTable(data.today, "Топ за сегодня")}
        {renderTable(data.week, "Топ за неделю")}
      </div>
    </div>
  );
}
