import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import "@/styles/globals.css";
import { TopNav } from "@/components/layout/TopNav";

export const metadata: Metadata = {
  title: "Qaramurt Taxi — Dispatch System",
  description: "Professional taxi dispatch and fleet management platform",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const isLoginPage = false; // handled by middleware

  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        {session ? (
          <>
            <TopNav session={session} />
            <div className="page-shell">{children}</div>
          </>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
