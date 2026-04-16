"use client";
import { useEffect, useState, useCallback } from "react";
import { useSocket } from "@/stores/socketStore";

interface ClientRow {
  id: number;
  phone: string;
  name: string | null;
  isBlacklisted: boolean;
  firstOrderDate: string | null;
  totalOrders: number;
  completedOrders: number;
  canceledOrders: number;
}

type SortField = "id" | "firstOrder" | "total" | "completed" | "canceled";
type SortDir = "asc" | "desc";

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const fetchClients = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);

    fetch(`/api/clients?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.data) setClients(d.data);
        if (d.total !== undefined) setTotal(d.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [search, sortBy, sortDir]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;
    const handleChange = () => fetchClients(true);

    socket.on("new_order", handleChange);
    socket.on("order_status_change", handleChange);

    return () => {
      socket.off("new_order", handleChange);
      socket.off("order_status_change", handleChange);
    };
  }, [socket, fetchClients]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc"); // default to desc when switching columns
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortBy !== field) return <span className="sort-icon inactive">⇅</span>;
    return <span className="sort-icon">{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("ru-RU");
  };

  return (
    <div className="page-content">
      <div className="action-bar">
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Клиенты</h2>
      </div>

      {/* Search filter */}
      <div className="filter-bar">
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
          <input
            className="form-input"
            placeholder="Поиск по телефону или имени..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ maxWidth: 340 }}
          />
          <button type="submit" className="btn btn-primary btn-sm">Найти</button>
          {search && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setSearchInput(""); setSearch(""); }}
            >
              Сбросить
            </button>
          )}
          <span className="text-muted" style={{ marginLeft: "auto", fontSize: 12 }}>
            Всего: {total}
          </span>
        </form>
      </div>

      {/* Table */}
      <div className="data-table-wrap">
        {loading ? (
          <div className="empty-state"><div className="pulse">Загрузка...</div></div>
        ) : clients.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👤</div>
            <div>{search ? "Ничего не найдено" : "Нет клиентов"}</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 50, paddingLeft: 30, textAlign: "center" }}>ID</th>
                <th style={{ textAlign: "center" }}>Телефон</th>
                <th style={{ textAlign: "center" }}>Имя</th>
                <th style={{ textAlign: "center" }} className="sortable-th" onClick={() => toggleSort("firstOrder")}>
                  Первый заказ {sortIcon("firstOrder")}
                </th>
                <th className="sortable-th" style={{ textAlign: "center" }} onClick={() => toggleSort("total")}>
                  Заказов всего {sortIcon("total")}
                </th>
                <th className="sortable-th" style={{ textAlign: "center" }} onClick={() => toggleSort("completed")}>
                  Выполненных заказов {sortIcon("completed")}
                </th>
                <th className="sortable-th" style={{ textAlign: "center" }} onClick={() => toggleSort("canceled")}>
                  Ложных заказов {sortIcon("canceled")}
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className={c.isBlacklisted ? "row-blacklisted" : ""}>
                  <td style={{ textAlign: "center", paddingLeft: 30 }} className="text-muted text-sm">{c.id}</td>
                  <td style={{ textAlign: "center" }} className="text-mono">{c.phone}</td>
                  <td style={{ textAlign: "center", fontWeight: c.name ? 500 : 400 }}>
                    {c.name || <span className="text-muted">—</span>}
                  </td>
                  <td style={{ textAlign: "center" }} className="text-muted text-sm">{formatDate(c.firstOrderDate)}</td>
                  <td style={{ textAlign: "center", fontWeight: 600 }}>
                    {c.totalOrders}
                  </td>
                  <td style={{ textAlign: "center", color: c.completedOrders > 0 ? "var(--status-free)" : "inherit" }}>
                    {c.completedOrders}
                  </td>
                  <td style={{ textAlign: "center", color: c.canceledOrders > 0 ? "var(--status-offline)" : "inherit", fontWeight: c.canceledOrders > 0 ? 600 : 400 }}>
                    {c.canceledOrders}
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
