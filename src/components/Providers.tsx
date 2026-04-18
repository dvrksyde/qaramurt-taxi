"use client";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import React from "react";
import { ThemeProvider } from "next-themes";

export function Providers({ session, children }: { session: Session | null; children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system">
      <SessionProvider session={session}>
        {children}
      </SessionProvider>
    </ThemeProvider>
  );
}
