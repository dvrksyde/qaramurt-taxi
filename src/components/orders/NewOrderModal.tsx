"use client";
import { useEffect, useCallback, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import type { NewOrderFormData, TaxiService, VehicleClass, VehicleClassGroup, Tariff, VehicleOption } from "@/types";
import { haversineKm, estimateMinutes } from "@/lib/pricing";
import dynamic from "next/dynamic";

const MiniMap = dynamic(() => import("./MiniMap"), { ssr: false });

interface Props { onClose: () => void; }

const DISTRIBUTION_METHODS = [
  { value: "automatic",  label: "автоматически" },
  { value: "broadcast",  label: "показать всем водителям сразу" },
  { value: "sequential", label: "показать всем водителям по очереди" },
  { value: "map_pick",   label: "выбрать водителя по карте" },
  { value: "list_pick",  label: "выбрать водителя по списку" },
] as const;

export function NewOrderModal({ onClose }: Props) {
  const [services, setServices] = useState<TaxiService[]>([]);
  const [classGroups, setClassGroups] = useState<VehicleClassGroup[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [options, setOptions] = useState<VehicleOption[]>([]);
  const [availability, setAvailability] = useState({ total: 1, online: 0, free: 0 });
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, watch, setValue, control, formState: { errors } } = useForm<NewOrderFormData>({
    defaultValues: {
      phone: "+7",
      timing: "now",
      distributionMethod: "automatic",
      stops: [],
      useBonuses: false,
      printReceipt: false,
      estimatedPrice: null,
      classId: null,
      tariffId: null,
      cashlessAccountId: null,
      optionIds: [],
    },
  });

  const { fields: stopFields, append: addStop, remove: removeStop } = useFieldArray({
    control,
    name: "stops",
  });

  const watchedClass = watch("classId");
  const watchedTariff = watch("tariffId");
  const watchedPickup = watch("pickupAddress");
  const watchedDropoff = watch("dropoffAddress");
  const watchedTiming = watch("timing");

  // Load initial data
  useEffect(() => {
    Promise.all([
      fetch("/api/services").then((r) => r.json()),
      fetch("/api/vehicle-classes").then((r) => r.json()),
      fetch("/api/vehicle-options").then((r) => r.json()),
    ]).then(([svc, cls, opt]) => {
      if (svc.data) setServices(svc.data);
      if (cls.data) setClassGroups(cls.data);
      if (opt.data) setOptions(opt.data);
    }).catch(console.error);
  }, []);

  // Load tariffs when class changes
  useEffect(() => {
    if (!watchedClass) { setTariffs([]); return; }
    fetch(`/api/tariffs?classId=${watchedClass}`)
      .then((r) => r.json())
      .then((d) => d.data && setTariffs(d.data))
      .catch(console.error);
  }, [watchedClass]);

  // Auto-estimate price when addresses and tariff are set
  useEffect(() => {
    if (!watchedPickup || !watchedDropoff || !watchedTariff) return;
    const timer = setTimeout(async () => {
      setEstimating(true);
      try {
        const res = await fetch("/api/orders/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pickupAddress: watchedPickup,
            dropoffAddress: watchedDropoff,
            tariffId: watchedTariff,
          }),
        });
        const d = await res.json();
        if (d.data?.estimatedPrice) {
          setValue("estimatedPrice", d.data.estimatedPrice);
        }
      } catch (e) {}
      setEstimating(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [watchedPickup, watchedDropoff, watchedTariff, setValue]);

  // Keyboard shortcut: Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const onSubmit = async (data: NewOrderFormData) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const d = await res.json();
      if (res.ok) {
        onClose();
      } else {
        alert(d.error || "Ошибка создания заказа");
      }
    } catch (e) {
      alert("Ошибка соединения с сервером");
    }
    setSubmitting(false);
  };

  const allClasses = classGroups.flatMap((g) => g.classes ?? []);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 1100, maxWidth: "96vw" }}>
        <div className="modal-header">
          Новый заказ
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="modal-body" style={{ display: "grid", gridTemplateColumns: "1fr 380px 220px", gap: 12 }}>
            {/* ── LEFT: Map ── */}
            <div style={{ minHeight: 320, borderRadius: 3, overflow: "hidden", background: "#e8e8e0" }}>
              <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--color-primary)", fontWeight: 600, textAlign: "right" }}>
                Подробнее »
              </div>
              <div style={{ height: 300 }}>
                <MiniMap />
              </div>
            </div>

            {/* ── CENTER: Order fields ── */}
            <div>
              {/* Phone + Service */}
              <div className="form-row">
                <span className="form-label">Звонок с:</span>
                <input
                  {...register("phone", { required: true })}
                  className="form-input"
                  style={{ maxWidth: 130 }}
                  placeholder="+7"
                  id="order-phone"
                />
                <span style={{ fontSize: 12, color: "var(--color-text-3)", flexShrink: 0 }}>на:</span>
                <select {...register("serviceId")} className="form-select" id="order-service">
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Name */}
              <div className="form-row">
                <span className="form-label">Имя:</span>
                <input
                  {...register("clientName")}
                  className="form-input highlight"
                  placeholder="Имя клиента"
                  id="order-name"
                />
              </div>

              {/* Timing */}
              <div className="form-row">
                <span className="form-label">Когда:</span>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                  <input type="radio" value="now" {...register("timing")} />
                  сейчас
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", marginLeft: 8 }}>
                  <input type="radio" value="scheduled" {...register("timing")} />
                  отложенный
                </label>
                {watchedTiming === "scheduled" && (
                  <input
                    type="datetime-local"
                    {...register("scheduledAt")}
                    className="form-input"
                    style={{ maxWidth: 160, marginLeft: 8 }}
                    id="order-scheduled-at"
                  />
                )}
              </div>

              {/* Pickup */}
              <div className="form-row">
                <span className="form-label">Откуда:</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
                  <span style={{ color: "#4a9ff5", fontSize: 16 }}>📍</span>
                  <input
                    {...register("pickupAddress")}
                    className="form-input"
                    placeholder="Адрес подачи"
                    id="order-pickup"
                  />
                </div>
              </div>

              {/* Dropoff */}
              <div className="form-row">
                <span className="form-label">Куда:</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
                  <span style={{ color: "#e84646", fontSize: 16 }}>🏁</span>
                  <input
                    {...register("dropoffAddress")}
                    className="form-input"
                    placeholder="Адрес назначения"
                    id="order-dropoff"
                  />
                </div>
              </div>

              {/* Extra stops */}
              {stopFields.map((field, i) => (
                <div key={field.id} className="form-row">
                  <span className="form-label">Заезд {i + 1}:</span>
                  <input
                    {...register(`stops.${i}.address`)}
                    className="form-input"
                    placeholder="Промежуточный адрес"
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStop(i)}>✕</button>
                </div>
              ))}

              <div style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => addStop({ address: "", order: stopFields.length + 1 })}
                >
                  + добавить заезд
                </button>
              </div>

              {/* Comment */}
              <div className="form-row" style={{ alignItems: "flex-start" }}>
                <span className="form-label" style={{ paddingTop: 4 }}>Комментарий:</span>
                <textarea {...register("comment")} className="form-textarea" rows={2} id="order-comment" />
              </div>

              {/* Pricing section */}
              <div style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 3, padding: "8px 10px", marginBottom: 8 }}>
                <div className="form-row">
                  <span className="form-label">Расстояние:</span>
                  <span className="text-muted">?</span>
                </div>
                <div className="form-row">
                  <span className="form-label">Класс:</span>
                  <select {...register("classId")} className="form-select" id="order-class">
                    <option value="">Любой</option>
                    {allClasses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <span className="form-label">Тариф:</span>
                  <select {...register("tariffId")} className="form-select" id="order-tariff">
                    <option value="">--------------------</option>
                    {tariffs.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <span className="form-label">Безнал (?):</span>
                  <select {...register("cashlessAccountId")} className="form-select" id="order-cashless">
                    <option value="">&lt;&lt; Не задан &gt;&gt;</option>
                  </select>
                </div>
                <div className="form-row">
                  <span className="form-label">Бонусы (?):</span>
                  <input type="checkbox" {...register("useBonuses")} className="form-checkbox" id="order-bonuses" />
                  <span className="text-muted text-sm">доступно ?</span>
                </div>
                <div className="form-row">
                  <span className="form-label">Стоимость (?):</span>
                  <input
                    {...register("estimatedPrice", { valueAsNumber: true })}
                    type="number"
                    className="form-input"
                    style={{ maxWidth: 70 }}
                    step="0.01"
                    id="order-price"
                  />
                  {estimating && <span className="text-muted text-sm pulse">расчёт...</span>}
                  <span className="form-label" style={{ marginLeft: "auto" }}>Предварительно:</span>
                  <input type="number" className="form-input" style={{ maxWidth: 70 }} readOnly
                    value={watch("estimatedPrice") ?? ""} />
                </div>
                <div style={{ marginLeft: 88 }}>
                  <button type="button" className="btn btn-ghost btn-sm">&lt;&lt; зафиксировать</button>
                </div>
                <div className="form-row">
                  <span className="form-label">Печатать чек</span>
                  <input type="checkbox" {...register("printReceipt")} className="form-checkbox" id="order-receipt" />
                </div>
              </div>

              {/* Distribution method */}
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Метод распределения заказа</div>
                {DISTRIBUTION_METHODS.map((m) => (
                  <label key={m.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4, cursor: "pointer" }}>
                    <input
                      type="radio"
                      value={m.value}
                      {...register("distributionMethod")}
                      id={`dist-${m.value}`}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>

            {/* ── RIGHT: Options + Availability ── */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Опции:</div>
              {options.map((opt) => (
                <label key={opt.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 5, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    value={opt.id}
                    {...register("optionIds")}
                    className="form-checkbox"
                  />
                  {opt.name}
                  {opt.priceModifier > 0 && (
                    <span className="text-muted text-sm">+{opt.priceModifier}₽</span>
                  )}
                </label>
              ))}

              <div className="divider" />

              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Доступно автомобилей:</div>
              <div style={{ fontSize: 12, lineHeight: 2 }}>
                <div>Всего: <strong>{availability.total}</strong></div>
                <div>На линии: <strong>{availability.online}</strong></div>
                <div>Свободные: <strong>{availability.free}</strong></div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>
                🔄
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting} id="btn-create-order">
              {submitting ? "Создание..." : "Создать заявку (Ctrl+Enter)"}
            </button>
            <button type="button" className="btn btn-ghost btn-lg" onClick={onClose}>
              Закрыть (Esc)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
