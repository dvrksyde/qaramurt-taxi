"use client";
import { useEffect, useState } from "react";

interface DocItem {
  id: number;
  driverId: number;
  docType: string;
  status: string;
  createdAt: string;
  driver?: { firstName: string; lastName: string };
}

export default function AdmissionsPage() {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admissions")
      .then((r) => r.json())
      .then((d) => d.data && setDocs(d.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const STATUS_LABELS: Record<string, { label: string; badge: string }> = {
    pending:  { label: "На проверке", badge: "pending" },
    approved: { label: "Одобрен",     badge: "in_progress" },
    rejected: { label: "Отклонён",    badge: "canceled" },
  };

  return (
    <div className="page-content">
      <div className="action-bar">
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Допуски</h2>
        <span className="text-muted text-sm" style={{ marginLeft: 8 }}>
          Верификация документов водителей
        </span>
      </div>

      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : docs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📄</div>
            <div>Нет документов на проверке</div>
            <div className="text-muted text-sm">Документы появятся когда водители загрузят их в приложении</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Водитель</th>
                <th>Тип документа</th>
                <th>Статус</th>
                <th>Загружен</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const sm = STATUS_LABELS[d.status] || { label: d.status, badge: "pending" };
                return (
                  <tr key={d.id}>
                    <td className="text-muted text-sm">{d.id}</td>
                    <td>
                      {d.driver
                        ? `${d.driver.lastName} ${d.driver.firstName[0]}.`
                        : `Водитель #${d.driverId}`}
                    </td>
                    <td>{d.docType}</td>
                    <td><span className={`status-badge ${sm.badge}`}>{sm.label}</span></td>
                    <td className="text-muted text-sm">
                      {new Date(d.createdAt).toLocaleDateString("ru")}
                    </td>
                    <td>
                      <div className="flex-row">
                        <button className="btn btn-primary btn-sm">👁 Просмотр</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--status-free)" }}>✓ Одобрить</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--status-offline)" }}>✕ Отклонить</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
