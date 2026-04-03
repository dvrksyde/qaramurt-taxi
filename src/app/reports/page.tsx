"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface ReportsData {
  summary: {
    totalOrders: number;
    grossRevenue: number;
    companyCommission: number;
    siteCommission: number;
    netCompanyProfit: number;
    siteRate: number;
    companyRatePercent: number;
    startDate: string;
    endDate: string;
  };
}

export default function ReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Date states. Default to today's date formatted as YYYY-MM-DD
  const todayStr = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState<string>(todayStr);
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [activePreset, setActivePreset] = useState<string | null>("today");

  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setPreset = (preset: "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month") => {
    setActivePreset(preset);
    const now = new Date();
    let start: Date;
    let end: Date;

    const f = (d: Date) => d.toISOString().split("T")[0];

    switch (preset) {
      case "today":
        start = new Date();
        end = new Date();
        break;
      case "yesterday":
        start = new Date(now);
        start.setDate(now.getDate() - 1);
        end = new Date(start);
        break;
      case "this_week":
        const day = now.getDay() || 7; 
        start = new Date(now);
        start.setDate(now.getDate() - day + 1);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        break;
      case "last_week":
        const day2 = now.getDay() || 7;
        start = new Date(now);
        start.setDate(now.getDate() - day2 - 6);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        break;
      case "this_month":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case "last_month":
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      default:
        return;
    }
    setStartDate(f(start));
    setEndDate(f(end));
  };
  
  const getPresetStyle = (preset: string) => {
    if (activePreset === preset) {
      return { background: "rgba(9, 132, 227, 0.1)", color: "#0984e3", fontSize: 13, padding: "6px 16px", borderRadius: 20, fontWeight: 600, border: "none" };
    }
    return { background: "#f5f6fa", color: "#636e72", fontSize: 13, padding: "6px 16px", borderRadius: 20, border: "none" };
  };

  useEffect(() => {
    if (status === "loading") return;
    
    // ... rest of useeffect logic
    const role = (session?.user as any)?.role;
    if (!session || role !== "admin") {
      router.push("/monitor");
      return;
    }

    setLoading(true);
    fetch(`/api/reports?startDate=${startDate}&endDate=${endDate}`)
      .then(async (r) => {
        const res = await r.json();
        if (!r.ok) throw new Error(res.error || "Failed to load");
        return res;
      })
      .then((res) => {
        if (res.data) setData(res.data);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [session, status, router, startDate, endDate]);

  if (status === "loading") {
    return (
      <div className="page-content center-all" style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="pulse" style={{ fontSize: 24 }}>Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="page-content" style={{ padding: 24, backgroundColor: "#f5f6fa", minHeight: "100vh" }}>
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, color: "#2d3436", fontSize: 28, fontWeight: 700 }}>Финансовая статистика</h1>
          <p style={{ color: "#636e72", margin: "8px 0 0 0" }}>
            Выберите период для расчета общей прибыли
          </p>
        </div>

        {/* Date Controls */}
        <div style={{ background: "#fff", padding: "20px", borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: 16, border: "1px solid #f1f2f6" }}>
          
          {/* Quick Presets */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 16, borderBottom: "1px solid #f1f2f6" }}>
            <button onClick={() => setPreset("today")} className="btn btn-ghost btn-sm" style={getPresetStyle("today")}>Сегодня</button>
            <button onClick={() => setPreset("yesterday")} className="btn btn-ghost btn-sm" style={getPresetStyle("yesterday")}>Вчера</button>
            <button onClick={() => setPreset("this_week")} className="btn btn-ghost btn-sm" style={getPresetStyle("this_week")}>Эта неделя</button>
            <button onClick={() => setPreset("last_week")} className="btn btn-ghost btn-sm" style={getPresetStyle("last_week")}>Прошлая неделя</button>
            <button onClick={() => setPreset("this_month")} className="btn btn-ghost btn-sm" style={getPresetStyle("this_month")}>Этот месяц</button>
            <button onClick={() => setPreset("last_month")} className="btn btn-ghost btn-sm" style={getPresetStyle("last_month")}>Прошлый месяц</button>
          </div>

          {/* Custom Date Picker */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#b2bec3", fontWeight: 600 }}>ИЛИ ВРУЧНУЮ:</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => { setStartDate(e.target.value); setActivePreset(null); }} 
                style={{ padding: "8px 14px", border: "1px solid #dfe6e9", borderRadius: 8, fontFamily: "inherit", color: "#2d3436", background: "#fafbfc", outline: "none", fontSize: 14 }}
              />
              <span style={{ color: "#b2bec3", fontWeight: 500 }}>до</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => { setEndDate(e.target.value); setActivePreset(null); }} 
                style={{ padding: "8px 14px", border: "1px solid #dfe6e9", borderRadius: 8, fontFamily: "inherit", color: "#2d3436", background: "#fafbfc", outline: "none", fontSize: 14 }}
              />
            </div>
          </div>
        </div>
      </div>

      {loading && !data && (
        <div className="pulse" style={{ fontSize: 18, color: "#6c5ce7", marginTop: 40 }}>Сбор данных за указанный период...</div>
      )}

      {error && (
        <div className="empty-state" style={{ marginTop: 20 }}>
          <div className="empty-state-icon">⚠️</div>
          <div style={{ color: "var(--status-offline)", marginTop: 16 }}>{error}</div>
        </div>
      )}

      {data && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          
          {/* Main Results Card */}
          <div style={{ background: "#fff", borderRadius: 12, padding: 32, boxShadow: "0 4px 15px rgba(0,0,0,0.05)", borderTop: "4px solid #0984e3", opacity: loading ? 0.6 : 1, transition: "opacity 0.2s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
              <h3 style={{ margin: 0, color: "#636e72", fontSize: 16, textTransform: "uppercase", letterSpacing: 1 }}>Финансовые итоги</h3>
              <div style={{ fontSize: 13, background: "#f1f2f6", padding: "6px 16px", borderRadius: 20, color: "#2d3436", fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#b2bec3", fontWeight: 500 }}>Период:</span>
                {new Date(data.summary.startDate).toLocaleDateString("ru-RU")} — {new Date(data.summary.endDate).toLocaleDateString("ru-RU")}
              </div>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 32, borderBottom: "1px solid #f1f2f6", paddingBottom: 24 }}>
              <div>
                <div style={{ fontSize: 36, fontWeight: 800, color: "#2d3436", lineHeight: 1 }}>{data.summary.totalOrders}</div>
                <div style={{ fontSize: 14, color: "#b2bec3", marginTop: 8 }}>успешных заказов</div>
              </div>
              <div>
                <div style={{ fontSize: 36, fontWeight: 700, color: "#2d3436", lineHeight: 1 }}>{data.summary.grossRevenue.toLocaleString("ru-RU")} <span style={{fontSize:20}}>тг.</span></div>
                <div style={{ fontSize: 14, color: "#b2bec3", marginTop: 8 }}>оборот по всем заказам (валовая выручка)</div>
              </div>
              <div style={{ background: "rgba(238, 82, 83, 0.05)", padding: 16, borderRadius: 8, borderLeft: "3px solid #ff7675" }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#d63031", lineHeight: 1 }}>{data.summary.siteCommission.toLocaleString("ru-RU")} <span style={{fontSize:16}}>тг.</span></div>
                <div style={{ fontSize: 13, color: "#ff7675", marginTop: 6 }}>комиссия разработчиков сайта (по {data.summary.siteRate} тг/заказ)</div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 24, flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ fontSize: 16, color: "#00b894", fontWeight: 700, textTransform: "uppercase" }}>Чистая прибыль компании</div>
                <div style={{ color: "#b2bec3", fontSize: 13, marginTop: 4, maxWidth: 500 }}>
                  Ставка: <strong>{data.summary.companyRatePercent}%</strong> от стоимости заказов. 
                  Общий доход составил: <strong>{data.summary.companyCommission.toLocaleString("ru-RU")} тг.</strong> минус комиссия разработчикам.
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 48, fontWeight: 800, color: "#00b894", lineHeight: 1 }}>{data.summary.netCompanyProfit.toLocaleString("ru-RU")} <span style={{fontSize:24}}>тг.</span></div>
              </div>
            </div>

          </div>

        </div>
      )}
    </div>
  );
}
