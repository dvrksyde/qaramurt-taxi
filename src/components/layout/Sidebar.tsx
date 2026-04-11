"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

interface Props { onClose: () => void; }

export function Sidebar({ onClose }: Props) {
  const pathname = usePathname();

  return (
    <>
      <div className="sidebar-overlay" onClick={onClose} />
      <aside className="sidebar">
        <div className="sidebar-header">
          <Image src="/logo-transparent.png" alt="Qaramurt Taxi" width={36} height={36} style={{ borderRadius: 8, objectFit: "contain" }} />
          <span>Qaramurt Taxi</span>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 18 }}
          >×</button>
        </div>

        <div style={{ padding: "30px 20px", color: "#888", fontSize: "14px", textAlign: "center", fontStyle: "italic" }}>
          Coming soon...
        </div>
      </aside>
    </>
  );
}
