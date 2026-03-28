"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import type { Session } from "next-auth";
import { Sidebar } from "./Sidebar";
import { useMonitorStore } from "@/stores/monitorStore";

interface Props { session: Session; }

const NAV_LINKS = [
  { href: "/monitor",    label: "Монитор",        countKey: null },
  { href: "/operators",  label: "Операторы",       countKey: null },
  { href: "/drivers",    label: "Водители",         countKey: null },
  { href: "/vehicles",   label: "Автомобили",       countKey: null },
  { href: "/admissions", label: "Допуски",          countKey: null },
  { href: "/journal",    label: "Журнал заказов",   countKey: null },
  { href: "/calls",      label: "Звонки",           countKey: null },
];

export function TopNav({ session }: Props) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isConnected, totalCash, advanceBalance } = useMonitorStore();

  return (
    <>
      <nav className="top-nav">
        {/* Hamburger */}
        <button
          className="nav-hamburger"
          onClick={() => setSidebarOpen(true)}
          title="Меню"
          aria-label="Open menu"
        >
          ☰
        </button>

        {/* Brand */}
        <div className="nav-brand">
          <span style={{ color: "#f5c518" }}>🚖</span>
          <span style={{ color: "#3db84a" }}>{session.user?.name || "Администратор"}</span>
          <span className="nav-brand-sub">(Выйти)</span>
          <span className="nav-brand-sub">|</span>
          <span className="nav-brand-sub">Общ. касса: {totalCash} руб.</span>
          <span style={{ color: "#f5c518" }} className="nav-brand-sub">ПО: {advanceBalance} руб.</span>
        </div>

        {/* Nav Links */}
        <div className="nav-links">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${pathname.startsWith(link.href) ? "active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Status */}
        <div className="nav-status">
          <span className={`nav-online-badge ${isConnected ? "" : "offline"}`}>
            {isConnected ? "ONLINE" : "OFFLINE"}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => signOut({ callbackUrl: "/login" })}
            style={{ color: "#e84646" }}
          >
            Выйти
          </button>
        </div>
      </nav>

      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar onClose={() => setSidebarOpen(false)} />
      )}
    </>
  );
}
