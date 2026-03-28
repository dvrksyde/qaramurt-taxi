"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props { onClose: () => void; }

const СПРАВОЧНИКИ = [
  { href: "/settings/classes",    label: "Классы автомобилей" },
  { href: "/settings/options",    label: "Опции автомобилей" },
  { href: "/settings/tariffs-driver", label: "Тарифы для водителей" },
  { href: "/settings/unlimited",  label: "Безлимиты для водителей" },
  { href: "/settings/services",   label: "Услуги для водителей" },
  { href: "/settings/services-tariffs", label: "Службы такси и тарифы" },
  { href: "/settings/geozones",   label: "Геозоны / Границы" },
  { href: "/settings/transfers",  label: "Трансферы (сетки тариф.)" },
  { href: "/settings/geozone-prices", label: "Цены в геозонах" },
  { href: "/settings/queues",     label: "Очереди (стоянки)" },
];

const НАСТРОЙКИ = [
  { href: "/settings/general",    label: "Общие настройки" },
  { href: "/settings/telephony",  label: "Настройки телефонии" },
  { href: "/settings/admissions", label: "Настройки допусков" },
  { href: "/settings/map-editor", label: "Редактор карт" },
  { href: "/settings/payments",   label: "Платежные системы" },
  { href: "/settings/online-kassa", label: "Он-лайн кассы (54-ФЗ)" },
  { href: "/settings/exchange",   label: "Настройки обменника" },
  { href: "/settings/ratings",    label: "Настройки рейтингов" },
  { href: "/settings/driver-reg", label: "Регистрация водителей" },
  { href: "/settings/contracts",  label: "Шаблоны договоров" },
];

const СТАНДАРТНОЕ = [
  { href: "/clients",             label: "Клиенты" },
  { href: "/blacklist",           label: "Чёрные списки" },
  { href: "/fuel-prices",         label: "Цены на топливо" },
  { href: "/shift-journal",       label: "Журнал смен" },
  { href: "/billing/cash",        label: "Касса" },
  { href: "/billing/acquiring",   label: "Отчёт по эквайрингу" },
  { href: "/billing/cashless",    label: "Безналичные расчёты" },
  { href: "/control",             label: "Контроль" },
];

export function Sidebar({ onClose }: Props) {
  const pathname = usePathname();

  return (
    <>
      <div className="sidebar-overlay" onClick={onClose} />
      <aside className="sidebar">
        <div className="sidebar-header">
          <span>🚖</span>
          <span>Qaramurt Taxi</span>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 18 }}
          >×</button>
        </div>

        <div className="sidebar-section-title">Справочники</div>
        {СПРАВОЧНИКИ.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-item ${pathname.startsWith(item.href) ? "active" : ""}`}
            onClick={onClose}
          >
            {item.label}
          </Link>
        ))}

        <div className="divider" />
        <div className="sidebar-section-title">Настройки</div>
        {НАСТРОЙКИ.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-item ${pathname.startsWith(item.href) ? "active" : ""}`}
            onClick={onClose}
          >
            {item.label}
          </Link>
        ))}

        <div className="divider" />
        <div className="sidebar-section-title">Стандартное</div>
        {СТАНДАРТНОЕ.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-item ${pathname.startsWith(item.href) ? "active" : ""}`}
            onClick={onClose}
          >
            {item.label}
          </Link>
        ))}
      </aside>
    </>
  );
}
