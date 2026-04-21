"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import type { Session } from "next-auth";
import { Sidebar } from "./Sidebar";
import { useMonitorStore } from "@/stores/monitorStore";
import { useSocket } from "@/stores/socketStore";
import { useTheme } from "next-themes";

interface Props { session: Session; }

/**
 * Nav links with permission requirements.
 * `requiredPerms: []` means any authenticated user can see it.
 * `requiredPerms: ["admin"]` means only visible for admins or users with "admin" permission.
 */
const NAV_LINKS = [
  { href: "/monitor",                  label: "Монитор",         requiredPerms: [] as string[] },
  { href: "/operators",                 label: "Операторы",       requiredPerms: ["admin"] },
  { href: "/drivers",                   label: "Водители",        requiredPerms: [] as string[] },
  { href: "/clients",                   label: "Клиенты",         requiredPerms: ["clients"] },
  { href: "/journal",                   label: "Журнал заказов",  requiredPerms: ["journal_own", "journal_all"] },
  { href: "/settings/tariffs-driver",   label: "Тарифы",          requiredPerms: ["admin"] },
  { href: "/settings/address-book",     label: "Адреса",          requiredPerms: ["admin"] },
  { href: "/reports",                   label: "Отчеты",          requiredPerms: ["admin"] },
];

export function TopNav({ session }: Props) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { totalCash, advanceBalance } = useMonitorStore();
  const { connected: isConnected } = useSocket();

  const user = session.user as any;
  const role: string = user?.role || "operator";
  const permissions: string[] = user?.permissions || [];
  const isAdmin = role === "admin";

  /** Check if user can see a nav link */
  const canSee = (requiredPerms: string[]): boolean => {
    if (isAdmin) return true;
    if (requiredPerms.length === 0) return true;
    return requiredPerms.some((p) => permissions.includes(p));
  };

  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
          <Image src="/logo-transparent.png" alt="Qaramurt Taxi" width={25} height={25} style={{ borderRadius: 6, objectFit: "contain" }} priority />
          <span style={{ color: "#3db84a" }}>{session.user?.name || "Администратор"}</span>
        </div>

        {/* Nav Links — filtered by permissions */}
        <div className="nav-links">
          {NAV_LINKS.filter((link) => canSee(link.requiredPerms)).map((link) => (
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

          {mounted && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title="Переключить тему"
              style={{ fontSize: 16, padding: "0 6px" }}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          )}

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
