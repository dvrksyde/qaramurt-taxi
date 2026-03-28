"use client";
import { useMonitorStore } from "@/stores/monitorStore";

export function SystemTab() {
  const { systemLog } = useMonitorStore();

  return (
    <div className="data-table-wrap" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
      {systemLog.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📡</div>
          <div>Системный журнал пуст</div>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Уровень</th>
              <th>Сообщение</th>
            </tr>
          </thead>
          <tbody>
            {systemLog.map((entry) => (
              <tr key={entry.id}>
                <td className="text-muted nowrap" style={{ fontSize: 11 }}>
                  {new Date(entry.timestamp).toLocaleTimeString("ru")}
                </td>
                <td>
                  <span style={{
                    color: entry.level === "error" ? "var(--status-offline)"
                         : entry.level === "warn"  ? "var(--status-busy)"
                         : "var(--status-free)",
                    fontWeight: 600, fontSize: 11,
                  }}>
                    {entry.level.toUpperCase()}
                  </span>
                </td>
                <td>{entry.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
