"use client";
import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import type { Driver } from "@/types";

interface Props {
  driver: Driver | null;
  onClose: () => void;
}

interface DriverFormData {
  lastName: string;
  firstName: string;
  phone: string;
  login: string;
  password?: string;
  password2?: string;
  callsign: string;
  comment: string;
  carPlate: string;
  carMake: string;
  carModel: string;
  carColor: string;
  carClassIds: string[];
  tariffGroupId?: string;
}

const CAR_COLORS = [
  "белый", "голубой", "жёлтый", "зеленый", "золотистый", "коричневый", "красный", "оранжевый",
  "светло-зеленый", "светло-красный", "светло-синий", "серебристый", "серый", "сине-зеленый", "синий",
  "тёмно-бежевый", "тёмно-зеленый", "тёмно-красный", "тёмно-синий", "фиолетовый", "чёрный"
];

const CAR_MAKES = [
  "Alpina", "Aston Martin", "Audi",
  "Bentley", "BMW", "Bugatti", "BYD",
  "Cadillac", "Changan", "Chery", "Chevrolet",
  "Daewoo", "Dodge", "Evolute", "Exeed",
  "Ferrari", "FIAT", "Ford", "Foton", "Geely",
  "Honda", "Huanghai", "Hummer", "Hyundai",
  "Infiniti", "Isuzu", "JAC", "Jaguar", "Jeep", "Kia", "Koenigsegg",
  "LADA", "LADA Vesta", "LADA X-Ray", "Lamborghini", "Lancia", "Land Rover", "Lexus", "Lincoln", "Lotus",
  "Maserati", "Maybach", "Mazda", "McLaren",
  "Mercedes-Benz", "Mitsubishi", "Nissan", "Omoda", "Opel",
  "Pagani", "Panoz", "Peugeot", "Porsche", "Ravon", "Renault", "Rolls-Royce", "Skoda", "Subaru", "Suzuki",
  "Toyota", "Volkswagen", "Volvo", "Vortex",
  "Велта", "Волга", "ГАЗ", "Газель", "ЗИЛ", "КАМАЗ", "Москвич"
];

/* ── Searchable Select for car makes ── */
function SearchableCarSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || "");
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = search
    ? CAR_MAKES.filter((m) => m.toLowerCase().startsWith(search.toLowerCase()))
    : CAR_MAKES;

  // Sync external value changes
  useEffect(() => {
    setSearch(value || "");
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (make: string) => {
    setSearch(make);
    onChange(make);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <input
        type="text"
        className="form-input"
        placeholder="<< Выберите >>"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        id="car-make"
        autoComplete="off"
      />
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid var(--color-border)",
            borderTop: "none",
            borderRadius: "0 0 4px 4px",
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "8px 12px", color: "var(--color-text-3)", fontSize: 12 }}>
              Ничего не найдено
            </div>
          ) : (
            filtered.map((make) => (
              <div
                key={make}
                onClick={() => handleSelect(make)}
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                  background: make === value ? "var(--color-primary-bg)" : "transparent",
                  borderBottom: "1px solid #f0f0f0",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#4a90d9";
                  e.currentTarget.style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = make === value ? "var(--color-primary-bg)" : "transparent";
                  e.currentTarget.style.color = "";
                }}
              >
                {make}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function DriverForm({ driver, onClose }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [autoGenCreds, setAutoGenCreds] = useState(!driver);
  const [vehicleGroups, setVehicleGroups] = useState<any[]>([]);
  const [tariffs, setTariffs] = useState<any[]>([]);
  // Stores generated credentials after save — used for WhatsApp share
  const [savedCreds, setSavedCreds] = useState<{ login: string; password: string; phone: string } | null>(null);

  const vehicle = driver?.vehicles?.[0]; // Get existing first vehicle if any

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<DriverFormData>({
    defaultValues: {
      lastName: driver ? driver.lastName : "",
      firstName: driver ? driver.firstName : "",
      phone: driver ? driver.phone : "",
      login: driver ? driver.login : "",
      callsign: driver?.callsign || "",
      comment: (driver as any)?.comment || "",
      carPlate: vehicle?.plate || "",
      carMake: vehicle?.make || "",
      carModel: vehicle?.model || "",
      carColor: vehicle?.color || "белый",
      carClassIds: vehicle?.classes?.map((c: any) => String(c.classId)) || [],
      tariffGroupId: (driver as any)?.tariffGroupId ? String((driver as any).tariffGroupId) : "",
      password: "",
      password2: "",
    },
  });

  useEffect(() => {
    fetch("/api/vehicle-classes")
      .then((r) => r.json())
      .then((d) => {
        if (d.data) setVehicleGroups(d.data);
      })
      .catch(console.error);

    fetch("/api/tariff-groups")
      .then((r) => r.json())
      .then((d) => {
        if (d.data) {
          const activeTariffs = d.data.filter((t: any) => t.type === "commission" && t.isActive);
          setTariffs(activeTariffs);

          if (!driver || !(driver as any).tariffGroupId) {
            const standard = activeTariffs.find((t: any) => t.name.toLowerCase() === "стандарт");
            if (standard) {
              setValue("tariffGroupId", String(standard.id));
            }
          }
        }
      })
      .catch(console.error);
  }, [driver, setValue]);

  const carMakeValue = watch("carMake");

  const onSubmit = async (data: DriverFormData) => {
    if (!autoGenCreds && data.password !== data.password2) {
      alert("Пароли не совпадают");
      return;
    }

    setSubmitting(true);
    try {
      if (autoGenCreds && !driver) {
        const phoneDigits = data.phone.replace(/\D/g, "");
        data.login = phoneDigits.slice(-10) || ('dr' + Math.floor(1000 + Math.random() * 9000));
        data.password = Math.random().toString(36).slice(-6).toUpperCase();
      }
      const method = driver ? "PATCH" : "POST";
      const url = driver ? `/api/drivers/${driver.id}` : "/api/drivers";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          autoGenCreds,
        }),
      });

      const d = await res.json();
      if (res.ok) {
        if (!driver && data.password) {
          // Store creds so the WhatsApp button can use them
          setSavedCreds({ login: data.login, password: data.password, phone: data.phone });
        } else {
          onClose();
        }
      } else {
        alert(d.error || "Ошибка сохранения");
      }
    } catch {
      alert("Ошибка соединения");
    }
    setSubmitting(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 800, maxWidth: "96vw", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "90vh" }}>

        {/* Yellow Header */}
        <div className="modal-header" style={{ flexShrink: 0, background: "#ffcc00", color: "#000", borderBottom: 0, padding: "16px 20px" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {driver ? `Редактировать водителя — ${driver.lastName} ${driver.firstName}` : "Новый водитель"}
          </div>
          <button type="button" className="modal-close" onClick={onClose} style={{ color: "#000", fontSize: 24, padding: 0, background: "transparent", border: "none", cursor: "pointer", marginTop: -4 }}>×</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="modal-body" style={{ background: "#fff", padding: "24px", overflowY: "auto", flexGrow: 1 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>

              {/* Left Column: Personal info */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13, color: "var(--color-text-3)", textTransform: "uppercase" }}>Личные данные</div>

                <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                  <span className="form-label" style={{ width: 120, fontSize: 13 }}>Фамилия:</span>
                  <input {...register("lastName", { required: true })} className="form-input" id="driver-last-name" />
                </div>
                <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                  <span className="form-label" style={{ width: 120, fontSize: 13 }}>Имя:</span>
                  <input {...register("firstName", { required: true })} className="form-input" id="driver-first-name" />
                </div>
                <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                  <span className="form-label" style={{ width: 120, fontSize: 13 }}>Позывной:</span>
                  <input {...register("callsign")} className="form-input" style={{ width: 100 }} id="driver-callsign" />
                </div>
                <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                  <span className="form-label" style={{ width: 120, fontSize: 13 }}>Моб. телефон:</span>
                  <input {...register("phone", { required: true })} className="form-input" placeholder="+7" id="driver-phone" />
                </div>

                <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                  <span className="form-label" style={{ width: 120, fontSize: 13 }}>Тариф (План):</span>
                  <select {...register("tariffGroupId")} className="form-select" id="driver-tariff">
                    {tariffs.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.value}%)</option>
                    ))}
                  </select>
                </div>

                <div className="divider" style={{ margin: "24px 0" }} />

                {/* Credentials */}
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13, color: "var(--color-text-3)", textTransform: "uppercase" }}>Доступ в приложение</div>

                <div className="form-row" style={{ marginBottom: 16, border: "none" }}>
                  <label htmlFor="driver-autogen" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", userSelect: "none", width: "100%" }}>
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={autoGenCreds}
                      onChange={(e) => setAutoGenCreds(e.target.checked)}
                      id="driver-autogen"
                    />
                    Сгенерировать логин и пароль автоматически
                  </label>
                </div>

                {!autoGenCreds && (
                  <>
                    <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                      <span className="form-label" style={{ width: 120, fontSize: 13 }}>Логин:</span>
                      <input {...register("login", { required: !driver && !autoGenCreds })} className="form-input" id="driver-login" />
                    </div>
                    <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                      <span className="form-label" style={{ width: 120, fontSize: 13 }}>Пароль:</span>
                      <input type="text" {...register("password", { required: !driver && !autoGenCreds })} className="form-input" id="driver-password" />
                    </div>
                    <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                      <span className="form-label" style={{ width: 120, fontSize: 13 }}>Ещё раз пароль:</span>
                      <input type="text" {...register("password2", { required: !driver && !autoGenCreds })} className="form-input" id="driver-password-confirm" />
                    </div>
                  </>
                )}

                {/* App invite buttons */}
                {savedCreds ? (
                  // After successful save — show WhatsApp send button with credentials
                  <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#166534", marginBottom: 6 }}>✅ Водитель сохранён!</div>
                    <div style={{ fontSize: 12, color: "#333", marginBottom: 8 }}>
                      Логин: <strong>{savedCreds.login}</strong> · Пароль: <strong>{savedCreds.password}</strong>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: "#25D366", color: "#fff", border: "none", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                        onClick={() => {
                          const phone = savedCreds.phone.replace(/\D/g, "");
                          const msg = encodeURIComponent(
                            `Assalomu alaykum! Qaramurt Taxi ilovasiga xush kelibsiz 🚗\n\nLoginingiz: ${savedCreds.login}\nParolingiz: ${savedCreds.password}\n\nIlovani yuklab oling:\nhttps://qaramurttaxi.onrender.com/download`
                          );
                          window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Отправить в WhatsApp
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Закрыть</button>
                    </div>
                  </div>
                ) : (
                  <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                    <span className="form-label" style={{ width: 120, fontSize: 13 }}>Отправить ссылку:</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ color: "#25D366", border: "1px solid #e0e0e0", fontSize: 12 }}
                        disabled={!driver}
                        title={!driver ? "Сначала сохраните водителя" : "Отправить данные в WhatsApp"}
                        onClick={() => {
                          if (!driver) return;
                          const phone = (watch("phone") || "").replace(/\D/g, "");
                          const login = watch("login") || "";
                          const msg = encodeURIComponent(
                            `Assalomu alaykum! Qaramurt Taxi ilovasiga xush kelibsiz 🚗\n\nLoginingiz: ${login}\n\nIlovani yuklab oling:\nhttps://qaramurttaxi.onrender.com/download`
                          );
                          window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
                        }}
                      >
                        WhatsApp
                      </button>
                    </div>
                  </div>
                )}

                <div className="divider" style={{ margin: "24px 0" }} />
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13, color: "var(--color-text-3)", textTransform: "uppercase" }}>Комментарий</div>
                <textarea {...register("comment")} className="form-textarea" rows={3} id="driver-comment" />
              </div>

              {/* Right Column: Vehicles Assignment */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13, color: "var(--color-text-3)", textTransform: "uppercase" }}>Автомобиль</div>
                <div style={{ fontSize: 12, color: "var(--color-text-2)", marginBottom: 16 }}>
                  {driver && vehicle ? "Данные привязанного автомобиля" : "Привяжите автомобиль к данному профилю водителя (по желанию)"}
                </div>

                <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                  <span className="form-label" style={{ width: 100, fontSize: 13 }}>Гос. номер:</span>
                  <input {...register("carPlate")} className="form-input" placeholder="н-р: 777AAA01" id="car-plate" />
                </div>

                <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                  <span className="form-label" style={{ width: 100, fontSize: 13 }}>Марка:</span>
                  <SearchableCarSelect
                    value={carMakeValue}
                    onChange={(v) => setValue("carMake", v)}
                  />
                </div>

                <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                  <span className="form-label" style={{ width: 100, fontSize: 13 }}>Модель:</span>
                  <input {...register("carModel")} className="form-input" placeholder="н-р: Camry" id="car-model" />
                </div>

                <div className="form-row" style={{ marginBottom: 12, border: "none" }}>
                  <span className="form-label" style={{ width: 100, fontSize: 13 }}>Цвет:</span>
                  <select {...register("carColor")} className="form-select" id="car-color">
                    {CAR_COLORS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="divider" style={{ margin: "24px 0" }} />
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13, color: "var(--color-text-3)", textTransform: "uppercase" }}>Классы автомобилей</div>

                {vehicleGroups.map((g) => (
                  <div key={g.id} style={{ marginBottom: 16, border: "1px solid var(--color-border-2)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ padding: "6px 12px", background: "var(--color-surface-2)", fontSize: 13, fontStyle: "italic", color: "var(--color-primary)", borderBottom: "1px solid var(--color-border-2)" }}>
                      {g.name}
                    </div>
                    <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8, background: "#f5f5f5" }}>
                      {g.classes.map((c: any) => (
                        <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            className="form-checkbox"
                            value={String(c.id)}
                            {...register("carClassIds")}
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </div>

          <div className="modal-footer" style={{ borderTop: "1px solid #eee", background: "#f9f9f9", padding: "16px 20px" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, width: "100%" }}>
              <button type="submit" className="btn btn-primary" style={{ background: "#d35400", borderColor: "#d35400", color: "white", padding: "0 24px" }} disabled={submitting} id="btn-save-driver">
                {submitting ? "Сохранение..." : "Сохранить"}
              </button>
              <button type="button" className="btn btn-ghost" style={{ background: "#fff", border: "1px solid #ccc", color: "#333", padding: "0 24px" }} onClick={onClose}>Отмена</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
