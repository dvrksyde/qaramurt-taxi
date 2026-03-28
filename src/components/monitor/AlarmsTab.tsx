"use client";
import { useMonitorStore } from "@/stores/monitorStore";

export function AlarmsTab() {
  const { alarms, clearAlarms } = useMonitorStore();

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      {alarms.length > 0 && (
        <div className="action-bar">
          <button className="btn btn-danger btn-sm" onClick={clearAlarms}>
            Сбросить все тревоги
          </button>
          <span className="text-danger" style={{ fontSize: 12, fontWeight: 600 }}>
            ⚠️ {alarms.length} активных тревог
          </span>
        </div>
      )}

      <div className="data-table-wrap">
        {alarms.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔔</div>
            <div>Нет активных тревог</div>
            <div className="text-muted text-sm">Экстренные сигналы от водителей появятся здесь</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Водитель</th>
                <th>Координаты</th>
                <th>Сообщение</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {alarms.map((alarm, i) => (
                <tr key={i} style={{ background: "#fff0f0" }}>
                  <td className="text-mono nowrap">
                    {new Date(alarm.timestamp).toLocaleTimeString("ru")}
                  </td>
                  <td>
                    <span className="text-danger" style={{ fontWeight: 600 }}>
                      ⚠️ Водитель #{alarm.driverId}
                    </span>
                  </td>
                  <td className="text-mono text-sm">
                    {alarm.lat.toFixed(5)}, {alarm.lng.toFixed(5)}
                  </td>
                  <td>{alarm.message || "Экстренный сигнал"}</td>
                  <td>
                    <button className="btn btn-primary btn-sm">На карте</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
