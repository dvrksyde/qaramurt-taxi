export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const user = session.user as any;
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Только для администратора" }, { status: 403 });
  }

  const { message, downloadUrl, minVersion } = await req.json().catch(() => ({}));

  const io = (global as Record<string, unknown>).socketIO as any;
  if (!io) return NextResponse.json({ error: "Socket недоступен" }, { status: 503 });

  io.to("drivers").emit("force_update", {
    message: message || "Доступно обновление приложения. Установите новую версию для продолжения работы.",
    downloadUrl: downloadUrl || process.env.APK_DOWNLOAD_URL || null,
    minVersion: minVersion || process.env.MIN_APP_VERSION || null,
  });

  return NextResponse.json({ ok: true });
}
