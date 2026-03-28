"use client";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import type { Driver } from "@/types";

interface Props {
  driver: Driver | null;
  onClose: () => void;
}

type Tab = "main" | "documents" | "rating" | "log";

interface DriverFormData {
  lastName: string;
  firstName: string;
  middleName: string;
  phone: string;
  login: string;
  password: string;
  password2: string;
  callsign: string;
  tariffGroupId: string;
  maxCredit: number;
  comment: string;
}

export function DriverForm({ driver, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("main");
  const [tariffGroups, setTariffGroups] = useState<Array<{ id: number; name: string; type: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [autoGenCreds, setAutoGenCreds] = useState(!driver);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<DriverFormData>({
    defaultValues: driver
      ? {
          lastName:  driver.lastName,
          firstName: driver.firstName,
          middleName: driver.middleName || "",
          phone:     driver.phone,
          login:     driver.login,
          callsign:  driver.callsign || "",
          maxCredit: driver.maxCredit,
        }
      : { maxCredit: 0 },
  });

  useEffect(() => {
    fetch("/api/tariff-groups")
      .then((r) => r.json())
      .then((d) => d.data && setTariffGroups(d.data))
      .catch(console.error);
  }, []);

  const onSubmit = async (data: DriverFormData) => {
    if (!driver && data.password !== data.password2) {
      alert("Пароли не совпадают");
      return;
    }
    setSubmitting(true);
    try {
      const method = driver ? "PATCH" : "POST";
      const url    = driver ? `/api/drivers/${driver.id}` : "/api/drivers";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const d = await res.json();
      if (res.ok) {
        onClose();
      } else {
        alert(d.error || "Ошибка сохранения");
      }
    } catch {
      alert("Ошибка соединения");
    }
    setSubmitting(false);
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "main",      label: "Основное" },
    { key: "documents", label: "Документы" },
    { key: "rating",    label: "Рейтинг" },
    { key: "log",       label: "Лог раздачи заказов" },
  ];

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 800, maxWidth: "96vw" }}>
        <div className="modal-header">
          {driver ? `Редактировать водителя — ${driver.lastName} ${driver.firstName}` : "Новый водитель"}
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* Tabs */}
        <div className="tabs-bar" style={{ background: "var(--color-surface-2)" }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`tab-btn ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="modal-body">
            {/* ── MAIN TAB ── */}
            {activeTab === "main" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16 }}>
                {/* Left: Personal info */}
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 12, color: "var(--color-text-3)", textTransform: "uppercase" }}>Личные данные</div>

                  <div className="form-row">
                    <span className="form-label">Фамилия:</span>
                    <input {...register("lastName", { required: true })} className="form-input" id="driver-last-name" />
                  </div>
                  <div className="form-row">
                    <span className="form-label">Имя:</span>
                    <input {...register("firstName", { required: true })} className="form-input" id="driver-first-name" />
                  </div>
                  <div className="form-row">
                    <span className="form-label">Отчество:</span>
                    <input {...register("middleName")} className="form-input" id="driver-middle-name" />
                  </div>
                  <div className="form-row">
                    <span className="form-label">Позывной:</span>
                    <input {...register("callsign")} className="form-input" style={{ maxWidth: 100 }} id="driver-callsign" />
                  </div>
                  <div className="form-row">
                    <span className="form-label">Моб. телефон:</span>
                    <input {...register("phone", { required: true })} className="form-input" placeholder="+7" id="driver-phone" />
                  </div>

                  <div className="divider" />

                  {/* Credentials */}
                  <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 12, color: "var(--color-text-3)", textTransform: "uppercase" }}>Доступ в приложение</div>

                  <div className="form-row">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={autoGenCreds}
                      onChange={(e) => setAutoGenCreds(e.target.checked)}
                      id="driver-autogen"
                    />
                    <label htmlFor="driver-autogen" style={{ fontSize: 12, cursor: "pointer" }}>
                      Сгенерировать логин и пароль автоматически
                    </label>
                  </div>

                  {!autoGenCreds && (
                    <>
                      <div className="form-row">
                        <span className="form-label">Логин:</span>
                        <input {...register("login", { required: !driver })} className="form-input" id="driver-login" />
                      </div>
                      <div className="form-row">
                        <span className="form-label">Пароль:</span>
                        <input type="password" {...register("password", { required: !driver })} className="form-input" id="driver-password" />
                      </div>
                      <div className="form-row">
                        <span className="form-label">Ещё раз пароль:</span>
                        <input type="password" {...register("password2")} className="form-input" id="driver-password2" />
                      </div>
                    </>
                  )}

                  {/* App invite buttons */}
                  <div className="form-row" style={{ marginTop: 4 }}>
                    <span className="form-label">Отправить ссылку:</span>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#25D366" }}>WhatsApp</button>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#7360F2" }}>Viber</button>
                    <button type="button" className="btn btn-ghost btn-sm">SMS</button>
                  </div>

                  <div className="divider" />
                  <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 12, color: "var(--color-text-3)", textTransform: "uppercase" }}>Комментарий</div>
                  <textarea {...register("comment")} className="form-textarea" rows={3} id="driver-comment" />
                </div>

                {/* Right: Tariff assignment */}
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 12, color: "var(--color-text-3)", textTransform: "uppercase" }}>Тарифы</div>

                  <div className="form-row" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <span className="form-label" style={{ minWidth: "auto", marginBottom: 4 }}>Группа сдельных тарифов:</span>
                    <select {...register("tariffGroupId")} className="form-select" id="driver-tariff-group">
                      <option value="">— не назначено —</option>
                      {tariffGroups
                        .filter((g) => g.type === "commission" || g.type === "fixed")
                        .map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                  </div>

                  <div className="form-row" style={{ flexDirection: "column", alignItems: "flex-start", marginTop: 8 }}>
                    <span className="form-label" style={{ minWidth: "auto", marginBottom: 4 }}>Группа безлимитных тарифов:</span>
                    <select className="form-select" id="driver-unlimited-group">
                      <option value="">— не назначено —</option>
                      {tariffGroups
                        .filter((g) => g.type === "unlimited")
                        .map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                  </div>

                  <div className="divider" />

                  <div className="form-row">
                    <span className="form-label" style={{ minWidth: "auto" }}>Макс. кредит:</span>
                    <input
                      type="number"
                      {...register("maxCredit", { valueAsNumber: true })}
                      className="form-input"
                      step="0.01"
                      id="driver-max-credit"
                    />
                    <span className="text-muted text-sm">руб.</span>
                  </div>

                  <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 3, fontSize: 11, color: "var(--color-text-2)" }}>
                    ⚠️ Если баланс ниже (-Макс. кредит), водитель не сможет принимать заказы.
                  </div>

                  <div className="divider" />
                  <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 12, color: "var(--color-text-3)", textTransform: "uppercase" }}>Автомобили</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-3)" }}>Привяжите автомобиль после создания водителя.</div>
                </div>
              </div>
            )}

            {/* ── DOCUMENTS TAB ── */}
            {activeTab === "documents" && (
              <div>
                <div style={{ fontSize: 13, color: "var(--color-text-2)", marginBottom: 12 }}>
                  Документы водителя для верификации (Допуски).
                </div>
                {[
                  "Водительское удостоверение",
                  "Паспорт",
                  "Техпаспорт автомобиля",
                  "Страховой полис",
                  "Медицинская справка",
                ].map((doc) => (
                  <div key={doc} className="form-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--color-border-2)" }}>
                    <span style={{ flex: 1, fontSize: 13 }}>{doc}</span>
                    <input type="file" accept="image/*,.pdf" style={{ fontSize: 12 }} />
                    <span className="status-badge canceled" style={{ fontSize: 10 }}>Не загружен</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── RATING TAB ── */}
            {activeTab === "rating" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 48, fontWeight: 800, color: "var(--color-yellow)" }}>
                    {driver ? Number(driver.rating).toFixed(1) : "—"}
                  </div>
                  <div>
                    <div style={{ fontSize: 13 }}>Средний рейтинг</div>
                    <div className="text-muted text-sm">На основании оценок пассажиров</div>
                  </div>
                </div>
                <div className="empty-state" style={{ height: "auto" }}>
                  <div>История оценок недоступна</div>
                </div>
              </div>
            )}

            {/* ── ORDER LOG TAB ── */}
            {activeTab === "log" && (
              <div className="empty-state" style={{ height: "auto", padding: "20px 0" }}>
                <div className="empty-state-icon">📋</div>
                <div>Лог раздачи заказов</div>
                <div className="text-muted text-sm">История предложения заказов этому водителю</div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="submit" className="btn btn-primary" disabled={submitting} id="btn-save-driver">
              {submitting ? "Сохранение..." : "Сохранить"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          </div>
        </form>
      </div>
    </div>
  );
}
