"use client";
import { useEffect, useCallback, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import type { NewOrderFormData, TaxiService, VehicleClass, VehicleClassGroup, Tariff } from "@/types";
import { haversineKm, estimateMinutes } from "@/lib/pricing";
import { useSocket } from "@/stores/socketStore";
import { useMonitorStore } from "@/stores/monitorStore";
import dynamic from "next/dynamic";

const MiniMap = dynamic(() => import("./MiniMap"), { ssr: false });
const DriverPickMap = dynamic(() => import("./DriverPickMap"), { ssr: false });

interface Props { onClose: () => void; }

const DISTRIBUTION_METHODS = [
  { value: "automatic",  label: "автоматически" },
  { value: "broadcast",  label: "показать всем водителям сразу" },
  { value: "manual",     label: "выбрать водителя" },
] as const;

export function NewOrderModal({ onClose }: Props) {
  const [services, setServices] = useState<TaxiService[]>([]);
  const [classGroups, setClassGroups] = useState<VehicleClassGroup[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [availability, setAvailability] = useState({ total: 1, online: 0, free: 0 });
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeField, setActiveField] = useState<'pickup' | 'dropoff'>('pickup');
  
  // Landmarks state
  const [landmarks, setLandmarks] = useState<any[]>([]);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Frequent client addresses
  const [clientAddresses, setClientAddresses] = useState<{ address: string; point: string | null; count: number }[]>([]);

  // Driver picker for manual selection
  const [pickerDrivers, setPickerDrivers] = useState<any[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerView, setPickerView] = useState<"list" | "map">("list");
  const [pickerSearch, setPickerSearch] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);

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
      pricePerKm: "80",
      hasLuggage: false,
      hasRoofLuggage: false,
      hasConditioner: false,
    },
  });

  const { fields: stopFields, append: addStop, remove: removeStop } = useFieldArray({
    control,
    name: "stops",
  });

  const watchedPhone = watch("phone");
  const watchedClass = watch("classId");
  const watchedTariff = watch("tariffId");
  const watchedPickup = watch("pickupAddress");
  const watchedDropoff = watch("dropoffAddress");
  const watchedTiming = watch("timing");
  const watchedServiceId = watch("serviceId");
  const watchedPickupPoint = watch("pickupPoint");
  const watchedDropoffPoint = watch("dropoffPoint");
  const watchedPricePerKm = watch("pricePerKm");
  const watchedHasLuggage = watch("hasLuggage");
  const watchedHasRoofLuggage = watch("hasRoofLuggage");
  const watchedHasConditioner = watch("hasConditioner");
  const distanceKm = watch("distanceKm");

  const isDelivery = services.find(s => s.id === Number(watchedServiceId))?.name?.toLowerCase()?.includes("доставка");

  // Fetch frequent addresses when phone changes
  useEffect(() => {
    const digits = (watchedPhone ?? "").replace(/\D/g, "");
    if (digits.length < 7) { setClientAddresses([]); return; }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/${encodeURIComponent(watchedPhone ?? "")}/addresses`);
        const d = await res.json();
        if (d.data) setClientAddresses(d.data);
      } catch {}
    }, 400);

    return () => clearTimeout(timer);
  }, [watchedPhone]);

  // Load initial data
  useEffect(() => {
    Promise.all([
      fetch("/api/services").then((r) => r.json()),
      fetch("/api/vehicle-classes").then((r) => r.json()),
      fetch("/api/drivers").then((r) => r.json()),
    ]).then(([svc, cls, drv]) => {
      if (svc.data) setServices(svc.data);
      if (cls.data) setClassGroups(cls.data);
      if (drv.data) {
        const all = drv.data as any[];
        const online = all.filter((d) => d.status !== "offline" && d.isActive);
        const free = all.filter((d) => d.status === "free" && d.isActive);
        setAvailability({ total: online.length, online: online.length, free: free.length });
      }
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

          const distKm = routeData.distance / 1000;
          setValue("distanceKm", Number(distKm.toFixed(3)));
        }
      } catch (e) {
        console.error("OSRM fetch failed", e);
      }
    };

    fetchRoute();
  }, [watchedPickupPoint, watchedDropoffPoint, setValue]);

  // Price calculation
  useEffect(() => {
    if (distanceKm == null) return;
    
    // Auto-calculate price
    const pricePerKm = Number(watchedPricePerKm);
    let basePrice = 290;
    const selectedClass = classGroups.flatMap(g => g.classes ?? []).find(c => c.id === Number(watchedClass));
    if (selectedClass?.name === "Комфорт") {
      basePrice = 390;
    }
    
    let estimated = Math.round((basePrice + distanceKm * pricePerKm) / 5) * 5;
    
    if (watchedHasLuggage) estimated += 100;
    if (watchedHasRoofLuggage) estimated += 200;
    if (watchedHasConditioner) estimated += 100;

    setValue("estimatedPrice", estimated);
  }, [distanceKm, watchedPricePerKm, watchedClass, classGroups, watchedHasLuggage, watchedHasRoofLuggage, watchedHasConditioner, setValue]);

  // Sync pricePerKm when class changes
  useEffect(() => {
    const isComfort = classGroups.flatMap(g => g.classes ?? []).find(c => c.id === Number(watchedClass))?.name === "Комфорт";
    if (isComfort) {
      if (watchedPricePerKm === "80") setValue("pricePerKm", "100");
      if (watchedPricePerKm === "120") setValue("pricePerKm", "140");
    } else {
      if (watchedPricePerKm === "100") setValue("pricePerKm", "80");
      if (watchedPricePerKm === "140") setValue("pricePerKm", "120");
    }
  }, [watchedClass, watchedPricePerKm, classGroups, setValue]);

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

  const watchedDistMethod = watch("distributionMethod");
  const needsDriverPick = watchedDistMethod === "manual";

  // Load drivers when manual selection is chosen
  useEffect(() => {
    if (!needsDriverPick) {
      setSelectedDriverId(null);
      setPickerDrivers([]);
      return;
    }
    setPickerLoading(true);
    setSelectedDriverId(null);
    setPickerSearch("");
    fetch("/api/drivers?sortBy=callsign&sortDir=asc")
      .then((r) => r.json())
      .then((d) => setPickerDrivers((d.data || []).filter((dr: any) => dr.isActive && dr.status !== "busy")))
      .catch(() => setPickerDrivers([]))
      .finally(() => setPickerLoading(false));
  }, [needsDriverPick]);

  const onSubmit = async (data: NewOrderFormData) => {
    if (needsDriverPick && !selectedDriverId) {
      alert("Выберите водителя из списка или карты");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, selectedDriverId }),
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

              {/* Frequent client addresses */}
              {clientAddresses.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: "var(--color-text-3)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Частые адреса клиента:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {clientAddresses.map((item, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setValue("pickupAddress", item.address);
                          if (item.point) {
                            const m = item.point.match(/POINT\(([\d.\-]+)\s+([\d.\-]+)\)/);
                            if (m) setValue("pickupPoint", [Number(m[2]), Number(m[1])]);
                          }
                          setActiveField('dropoff');
                        }}
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          borderRadius: 12,
                          border: "1px solid var(--color-primary)",
                          background: "var(--color-surface-2)",
                          color: "var(--color-primary)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          maxWidth: 200,
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                        }}
                        title={item.address}
                      >
                        📍 {item.address.length > 26 ? item.address.slice(0, 24) + "…" : item.address}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                  {allClasses.filter(c => ["Эконом", "Комфорт"].includes(c.name)).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <span className="form-label">Тариф:</span>
                {(() => {
                  const isComfort = classGroups.flatMap(g => g.classes ?? []).find(c => c.id === Number(watchedClass))?.name === "Комфорт";
                  const cityPrice = isComfort ? "100" : "80";
                  const subPrice = isComfort ? "140" : "120";
                  return (
                    <>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                        <input type="radio" value={cityPrice} {...register("pricePerKm")} /> {cityPrice} ₸/км (гор.)
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", marginLeft: 12 }}>
                        <input type="radio" value={subPrice} {...register("pricePerKm")} /> {subPrice} ₸/км (за.)
                      </label>
                    </>
                  );
                })()}
              </div>



              <div style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Метод распределения</div>
                {DISTRIBUTION_METHODS.map((m) => (
                  <label key={m.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4, cursor: "pointer" }}>
                    <input type="radio" value={m.value} {...register("distributionMethod")} /> {m.label}
                  </label>
                ))}
              </div>

              {/* Driver picker for manual selection */}
              {needsDriverPick && (() => {
                const parseWkt = (wkt: string | null): [number, number] | null => {
                  if (!wkt) return null;
                  const m = wkt.match(/POINT\(([^ ]+) ([^ ]+)\)/);
                  return m ? [parseFloat(m[2]), parseFloat(m[1])] : null;
                };
                const driverPins = pickerDrivers
                  .map((d: any) => {
                    const loc = parseWkt(d.currentLocation);
                    if (!loc) return null;
                    return { id: d.id, callsign: d.callsign, firstName: d.firstName, lastName: d.lastName, status: d.status, lat: loc[0], lng: loc[1] };
                  }).filter(Boolean) as any[];

                const selectedDriver = pickerDrivers.find((d) => d.id === selectedDriverId);
                const pickupCoords = watchedPickupPoint as [number, number] | null ?? null;

                return (
                  <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-2)", textTransform: "uppercase" }}>
                        ВЫБЕРИТЕ ВОДИТЕЛЯ
                      </div>
                      <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
                        <button type="button" onClick={() => setPickerView("list")} style={{ padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: pickerView === "list" ? "#0984e3" : "transparent", color: pickerView === "list" ? "#fff" : "var(--color-text-2)" }}>📋</button>
                        <button type="button" onClick={() => setPickerView("map")} style={{ padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", background: pickerView === "map" ? "#0984e3" : "transparent", color: pickerView === "map" ? "#fff" : "var(--color-text-2)" }}>🗺️</button>
                      </div>
                    </div>

                    {pickerLoading ? (
                      <div style={{ textAlign: "center", padding: 12, color: "var(--color-text-3)", fontSize: 12 }}>Загрузка водителей...</div>
                    ) : pickerView === "list" ? (
                      <>
                        <input
                          type="text"
                          placeholder="Поиск..."
                          value={pickerSearch}
                          onChange={(e) => setPickerSearch(e.target.value)}
                          style={{ width: "100%", padding: "5px 8px", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12, boxSizing: "border-box", marginBottom: 6, background: "var(--color-surface)", color: "var(--color-text)", outline: "none" }}
                        />
                        <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                          {pickerDrivers.filter((d) => {
                            const q = pickerSearch.toLowerCase();
                            return !q || d.callsign?.toLowerCase().includes(q) || d.firstName?.toLowerCase().includes(q) || d.lastName?.toLowerCase().includes(q);
                          }).map((d) => (
                            <div key={d.id} onClick={() => setSelectedDriverId(d.id === selectedDriverId ? null : d.id)}
                              style={{ padding: "5px 8px", borderRadius: 6, cursor: "pointer", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center",
                                background: selectedDriverId === d.id ? "rgba(9,132,227,0.12)" : "var(--color-surface)",
                                border: selectedDriverId === d.id ? "1px solid #0984e3" : "1px solid var(--color-border)" }}>
                              <span>{d.callsign && <strong style={{ marginRight: 4 }}>{d.callsign}</strong>}{d.lastName} {d.firstName}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: d.status === "free" ? "rgba(0,184,148,0.15)" : "rgba(99,110,114,0.15)", color: d.status === "free" ? "#00b894" : "#636e72" }}>
                                {d.status === "free" ? "Свободен" : "Оффлайн"}
                              </span>
                            </div>
                          ))}
                          {pickerDrivers.length === 0 && <div style={{ textAlign: "center", padding: 10, color: "var(--color-text-3)", fontSize: 12 }}>Нет свободных водителей</div>}
                        </div>
                      </>
                    ) : (
                      <div style={{ height: 180, borderRadius: 8, overflow: "hidden", border: "1px solid var(--color-border)" }}>
                        {driverPins.length === 0
                          ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-3)", fontSize: 12 }}>Нет водителей с GPS</div>
                          : <DriverPickMap drivers={driverPins} pickup={pickupCoords} selectedDriverId={selectedDriverId} onSelectDriver={(id) => setSelectedDriverId(id === selectedDriverId ? null : id)} />}
                      </div>
                    )}

                    {selectedDriver && (
                      <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: "rgba(0,184,148,0.1)", border: "1px solid rgba(0,184,148,0.3)", fontSize: 12, fontWeight: 600, color: "#00b894" }}>
                         ✅ {selectedDriver.callsign ? `${selectedDriver.callsign} · ` : ""}{selectedDriver.lastName} {selectedDriver.firstName}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* ── RIGHT: Price & Stats ── */}
            <div>
              <div style={{ background: "var(--color-surface-2)", padding: 12, borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--color-text-2)", marginBottom: 4 }}>Расчет стоимости:</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--color-primary)" }}>
                  {(watch("estimatedPrice") as number | null) || 0} <span style={{ fontSize: 14 }}>₸</span>
                </div>
                {watch("distanceKm") && (
                  <div style={{ fontSize: 12, marginTop: 4, color: "#444" }}>
                    Дистанция: <strong>{watch("distanceKm") as number} км</strong>
                  </div>
                )}
              </div>

              <div style={{ background: "var(--color-surface-2)", padding: 12, borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-2)", marginBottom: 8 }}>Опции заказа:</div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
                  <input type="checkbox" {...register("hasLuggage")} /> Багаж (+100)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
                  <input type="checkbox" {...register("hasRoofLuggage")} /> Верхний багаж (+200)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 0, cursor: "pointer" }}>
                  <input type="checkbox" {...register("hasConditioner")} /> Кондиционер (+100)
                </label>
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
