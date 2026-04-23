import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import "@/styles/globals.css";
import { TopNav } from "@/components/layout/TopNav";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Qaramurt Taxi — Dispatch System",
  description: "Professional taxi dispatch and fleet management platform",
  icons: {
    icon: "/logo-transparent.png",
    apple: "/logo-transparent.png",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <Providers session={session}>
          {session ? (
            <>
              <TopNav session={session} />
              <div className="page-shell">{children}</div>
            </>
          ) : (
            children
          )}
        </Providers>
      </body>
    </html>
  );
}
