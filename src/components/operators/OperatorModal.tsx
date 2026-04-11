"use client";
import React, { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import type { Operator } from "@/types";

interface Props {
  operator?: Operator | null;
  onClose: () => void;
  onSuccess: () => void;
}

// Only permissions that are actually enforced in the codebase
const PERMISSIONS_LIST = [
  { key: "current_orders",   label: "Текущие заказы и монитор" },
  { key: "journal_own",      label: "Журнал заказов (только свои)" },
  { key: "journal_all",      label: "Журнал заказов (все операторы)" },
  { key: "accept_calls",     label: "Принимать входящие звонки" },
  { key: "add_drivers",      label: "Добавлять новых водителей" },
  { key: "edit_drivers",     label: "Редактировать водителей и баланс" },
  { key: "delete_drivers",   label: "Удалять водителей" },
  { key: "clients",          label: "Просматривать и редактировать клиентов" },
  { key: "vehicle_admissions", label: "Выдавать / принимать автомобили" },
  { key: "kassa_report_all", label: "Просматривать отчёт по кассе" },
  { key: "kassa_operations", label: "Создавать операции по кассе" },
  { key: "admin",            label: "Администрирование (полный доступ)" },
];

export function OperatorModal({ operator, onClose, onSuccess }: Props) {
  const [submitting, setSubmitting] = useState(false);

  // Parse existing permissions from operator
  const existingPerms = Array.isArray(operator?.permissions) ? operator.permissions as string[] : [];

  const { register, handleSubmit, watch, setValue, getValues } = useForm({
    defaultValues: {
      name: operator?.name || "",
      login: operator?.login || "",
      password: "",
      passwordConfirm: "",
    }
  });

  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set(existingPerms));
  const permScrollRef = useRef<HTMLDivElement>(null);

  const watchPassword = watch("password");

  const togglePerm = (key: string) => {
    setSelectedPerms(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedPerms(new Set(PERMISSIONS_LIST.map(p => p.key)));
  };

  const deselectAll = () => {
    setSelectedPerms(new Set());
  };

  const onSubmit = async (data: any) => {
    if (data.password && data.password !== data.passwordConfirm) {
      alert("Пароли не совпадают!");
      return;
    }
    if (!operator && !data.password) {
      alert("Необходимо задать пароль!");
      return;
    }

    setSubmitting(true);
    try {
      const url = operator ? `/api/operators/${operator.id}` : "/api/operators";
      const method = operator ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          login: data.login,
          password: data.password || undefined,
          role: operator?.role || "operator",
          permissions: Array.from(selectedPerms),
        }),
      });

      const d = await res.json();
      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        alert(d.error || "Ошибка сохранения");
      }
    } catch {
      alert("Ошибка сети");
    }
    setSubmitting(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 820, maxWidth: "96vw" }}>
        <div className="modal-header">
          {operator ? "Редактировать оператора" : "Добавить оператора"}
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="modal-body" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, minHeight: 380 }}>

            {/* ── LEFT: Credentials ── */}
            <div className="op-modal-section">
              <h3 className="op-modal-section-title">Учетные данные</h3>

              <div className="form-row" style={{ marginBottom: 12 }}>
                <span className="form-label">ФИО:</span>
                <input
                  {...register("name", { required: true })}
                  className="form-input"
                  style={{ flex: 1 }}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 12 }}>
                <span className="form-label">Логин:</span>
                <input
                  {...register("login", { required: true })}
                  className="form-input"
                  style={{ flex: 1 }}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 12 }}>
                <span className="form-label">{operator ? "Новый пароль:" : "Пароль:"}</span>
                <input
                  type="password"
                  placeholder={operator ? "Оставьте пустым, чтобы не менять" : ""}
                  {...register("password", { required: !operator })}
                  className="form-input"
                  style={{ flex: 1 }}
                />
              </div>

              <div className="form-row" style={{ marginBottom: 12 }}>
                <span className="form-label">Еще раз пароль:</span>
                <input
                  type="password"
                  {...register("passwordConfirm")}
                  className="form-input"
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            {/* ── RIGHT: Permissions ── */}
            <div className="op-modal-section" style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 className="op-modal-section-title" style={{ marginBottom: 0 }}>Права</h3>
                <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                  <button type="button" className="op-action-link" style={{ color: "var(--color-primary)" }} onClick={selectAll}>
                    Вкл. все
                  </button>
                  <button type="button" className="op-action-link" style={{ color: "var(--color-text-3)" }} onClick={deselectAll}>
                    Откл. все
                  </button>
                </div>
              </div>

              <div ref={permScrollRef} className="op-perm-scroll">
                {PERMISSIONS_LIST.map((perm) => (
                  <label key={perm.key} className="op-perm-item">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={selectedPerms.has(perm.key)}
                      onChange={() => togglePerm(perm.key)}
                    />
                    <span>{perm.label}</span>
                  </label>
                ))}

                <div className="op-perm-warning">
                  <strong>⚠️ Внимание!</strong> Возможны злоупотребления, если используется автоматизированный вывод средств водителями.
                </div>
              </div>
            </div>

          </div>

          <div className="modal-footer">
            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
              {submitting ? "Сохранение..." : (operator ? "Сохранить" : "Добавить")}
            </button>
            <button type="button" className="btn btn-ghost btn-lg" onClick={onClose}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
