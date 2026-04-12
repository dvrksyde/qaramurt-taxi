"use client";
import { useEffect, useCallback, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import type { NewOrderFormData, TaxiService, VehicleClass, VehicleClassGroup, Tariff, VehicleOption } from "@/types";
import { haversineKm, estimateMinutes } from "@/lib/pricing";
import { useSocket } from "@/stores/socketStore";
import { useMonitorStore } from "@/stores/monitorStore";
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
  const [activeField, setActiveField] = useState<'pickup' | 'dropoff'>('pickup');
  
  // Landmarks state
  const [landmarks, setLandmarks] = useState<any[]>([]);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { dispatchOrder } = useSocket();
  const monitorStore = useMonitorStore();

  // Route state
  const [route, setRoute] = useState<[number, number][] | null>(null);

  const { register, handleSubmit, watch, setValue, control, setFocus, formState: { errors } } = useForm<NewOrderFormData>({
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
      pricePerKm: "80",
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
  const watchedServiceId = watch("serviceId");
  const watchedPickupPoint = watch("pickupPoint");
  const watchedDropoffPoint = watch("dropoffPoint");
  const watchedPricePerKm = watch("pricePerKm");

  const isDelivery = services.find(s => s.id === Number(watchedServiceId))?.name?.toLowerCase()?.includes("доставка");

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

  // Handle outside click for landmarks dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowLandmarks(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Landmark search
  useEffect(() => {
    const query = activeField === 'pickup' ? watchedPickup : watchedDropoff;
    if (!query || query.trim().length === 0) {
      setLandmarks([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/address-book?q=${encodeURIComponent(query)}`);
        const d = await res.json();
        if (d.data) {
          setLandmarks(d.data);
          setSelectedIndex(-1);
        }
      } catch (e) {}
    }, 150);

    return () => clearTimeout(timer);
  }, [watchedPickup, watchedDropoff, activeField]);

  // Route & Distance logic (OSRM)
  useEffect(() => {
    if (!watchedPickupPoint || !watchedDropoffPoint) {
      setRoute(null);
      return;
    }

    const fetchRoute = async () => {
      const [lat1, lng1] = watchedPickupPoint;
      const [lat2, lng2] = watchedDropoffPoint;
      
      try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`);
        const data = await res.json();
        
        if (data.code === "Ok" && data.routes?.[0]) {
          const routeData = data.routes[0];
          // Convert [lng, lat] to [lat, lng]
          const coords = routeData.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
          setRoute(coords);

          const distanceKm = routeData.distance / 1000;
          setValue("distanceKm", Number(distanceKm.toFixed(3)));

          // Auto-calculate price
          const pricePerKm = Number(watchedPricePerKm);
          const basePrice = 290;
          const estimated = Math.round((basePrice + distanceKm * pricePerKm) / 5) * 5;
          setValue("estimatedPrice", estimated);
        }
      } catch (e) {
        console.error("OSRM fetch failed", e);
      }
    };

    fetchRoute();
  }, [watchedPickupPoint, watchedDropoffPoint, watchedPricePerKm, setValue]);

  // Keyboard shortcut: Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    try {
      // Single call — server handles priority:
      // 1. Nearest landmark (100m) → popular name
      // 2. Yandex street → popular street name from address book + house number
      // 3. Fallback: official address
      const geoRes = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
      const geoData = await geoRes.json();
      const address = geoData.data?.address;

      if (address) {
        if (activeField === 'pickup') {
          setValue("pickupAddress", address);
          setValue("pickupPoint", [lat, lng]);
          if (isDelivery) {
            setActiveField('dropoff');
            setTimeout(() => setFocus("dropoffAddress"), 10);
          }
        } else {
          setValue("dropoffAddress", address);
          setValue("dropoffPoint", [lat, lng]);
        }
      }
    } catch (e) {
      console.error("Map click geocoding failed", e);
    }
  }, [activeField, setValue, isDelivery, setFocus]);

  const handleLandmarkSelect = (item: any) => {
    if (activeField === 'pickup') {
      setValue("pickupAddress", item.name);
      setValue("pickupPoint", [Number(item.latitude), Number(item.longitude)]);
      if (isDelivery) {
        setActiveField('dropoff');
        setTimeout(() => setFocus("dropoffAddress"), 10);
      }
    } else {
      setValue("dropoffAddress", item.name);
      setValue("dropoffPoint", [Number(item.latitude), Number(item.longitude)]);
    }
    setShowLandmarks(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showLandmarks || landmarks.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % landmarks.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + landmarks.length) % landmarks.length);
    } else if (e.key === "Enter") {
      if (selectedIndex >= 0 && selectedIndex < landmarks.length) {
        e.preventDefault();
        handleLandmarkSelect(landmarks[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      setShowLandmarks(false);
    }
  };

  const onSubmit = async (data: NewOrderFormData) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const d = await res.json();
        const createdOrder = d.data;
        
        // Push explicitly via socket to bypass Next.js API isolation
        dispatchOrder({
          orderId: createdOrder.id,
          method: data.distributionMethod,
          classId: data.classId ? parseInt(data.classId as unknown as string) : undefined
        });

        // Locally add into monitor
        monitorStore.addOrder(createdOrder);

        onClose();
      } else {
        const d = await res.json();
        alert(d.error || "Ошибка создания заказа");
      }
    } catch (e) {
      alert("Ошибка соединения с сервером");
    }
    setSubmitting(false);
  };

  const allClasses = classGroups.flatMap((g) => g.classes ?? []);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 1350, maxWidth: "96vw" }}>
        <div className="modal-header">
          Новый заказ
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="modal-body" style={{ display: "grid", gridTemplateColumns: "1fr 380px 220px", gap: 12 }}>
            {/* ── LEFT: Map ── */}
            <div style={{ minHeight: 500, borderRadius: 3, overflow: "hidden", background: "#e8e8e0", position: "relative" }}>
              <div style={{ height: 500 }}>
                <MiniMap 
                  pickup={watchedPickupPoint} 
                  dropoff={watchedDropoffPoint} 
                  route={route || undefined}
                  onMapClick={handleMapClick} 
                />
              </div>
            </div>

            {/* ── CENTER: Order fields ── */}
            <div>
              <div className="form-row">
                <span className="form-label">Звонок с:</span>
                <input {...register("phone", { required: true })} className="form-input" style={{ maxWidth: 130 }} placeholder="+7" />
                <span style={{ fontSize: 12, color: "var(--color-text-3)", flexShrink: 0 }}>на:</span>
                <select {...register("serviceId")} className="form-select">
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <span className="form-label">Имя:</span>
                <input {...register("clientName")} className="form-input highlight" placeholder="Имя клиента" />
              </div>

              <div className="form-row">
                <span className="form-label">Когда:</span>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                  <input type="radio" value="now" {...register("timing")} /> сейчас
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", marginLeft: 8 }}>
                  <input type="radio" value="scheduled" {...register("timing")} /> отложенный
                </label>
                {watchedTiming === "scheduled" && (
                  <input type="datetime-local" {...register("scheduledAt")} className="form-input" style={{ maxWidth: 160, marginLeft: 8 }} />
                )}
              </div>

              {/* Pickup Address + Autocomplete */}
              <div className="form-row" style={{ position: "relative" }}>
                <span className="form-label">Откуда:</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
                  <span style={{ color: "#4a9ff5", fontSize: 16 }}>📍</span>
                  <input
                    {...register("pickupAddress")}
                    onFocus={() => { setActiveField('pickup'); setShowLandmarks(true); }}
                    onKeyDown={handleKeyDown}
                    className="form-input"
                    placeholder="Адрес подачи"
                    autoComplete="off"
                  />
                </div>
                {activeField === 'pickup' && showLandmarks && landmarks.length > 0 && (
                  <div ref={dropdownRef} className="landmark-dropdown">
                    {landmarks.map((item, index) => (
                      <div 
                        key={item.id} 
                        className={`landmark-item ${index === selectedIndex ? 'selected' : ''}`}
                        onClick={() => handleLandmarkSelect(item)}
                        onMouseEnter={() => setSelectedIndex(index)}
                      >
                        <div className="landmark-name">{item.name}</div>
                        <div className="landmark-full">{item.fullName}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Dropoff Address + Autocomplete */}
              {(() => {
                if (isDelivery) {
                  return (
                    <div className="form-row" style={{ position: "relative" }}>
                      <span className="form-label">Куда:</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
                        <span style={{ color: "#f54a4a", fontSize: 16 }}>🏁</span>
                        <input
                          {...register("dropoffAddress")}
                          onFocus={() => { setActiveField('dropoff'); setShowLandmarks(true); }}
                          onKeyDown={handleKeyDown}
                          className="form-input highlight"
                          placeholder="Адрес доставки"
                          autoComplete="off"
                        />
                      </div>
                      {activeField === 'dropoff' && showLandmarks && landmarks.length > 0 && (
                        <div ref={dropdownRef} className="landmark-dropdown">
                          {landmarks.map((item, index) => (
                            <div 
                              key={item.id} 
                              className={`landmark-item ${index === selectedIndex ? 'selected' : ''}`}
                              onClick={() => handleLandmarkSelect(item)}
                              onMouseEnter={() => setSelectedIndex(index)}
                            >
                              <div className="landmark-name">{item.name}</div>
                              <div className="landmark-full">{item.fullName}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}

              <div className="form-row">
                <span className="form-label">Класс:</span>
                <select {...register("classId")} className="form-select">
                  <option value="">Любой</option>
                  {allClasses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <span className="form-label">Тариф:</span>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                  <input type="radio" value="80" {...register("pricePerKm")} /> 80 ₸/км (гор.)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", marginLeft: 12 }}>
                  <input type="radio" value="110" {...register("pricePerKm")} /> 110 ₸/км (за.)
                </label>
              </div>

              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Метод распределения</div>
                {DISTRIBUTION_METHODS.map((m) => (
                  <label key={m.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4, cursor: "pointer" }}>
                    <input type="radio" value={m.value} {...register("distributionMethod")} /> {m.label}
                  </label>
                ))}
              </div>
            </div>

            {/* ── RIGHT: Price & Stats ── */}
            <div>
              <div style={{ background: "#f8f9fa", padding: 12, borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Расчет стоимости:</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--color-primary)" }}>
                  {(watch("estimatedPrice") as number | null) || 0} <span style={{ fontSize: 14 }}>₸</span>
                </div>
                {watch("distanceKm") && (
                  <div style={{ fontSize: 12, marginTop: 4, color: "#444" }}>
                    Дистанция: <strong>{watch("distanceKm") as number} км</strong>
                  </div>
                )}
              </div>

              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Авто на линии:</div>
              <div style={{ fontSize: 12, lineHeight: 2 }}>
                <div>Всего: <strong>{availability.total}</strong></div>
                <div>Свободные: <strong style={{ color: "green" }}>{availability.free}</strong></div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
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
