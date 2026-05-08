export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    minVersion: process.env.MIN_APP_VERSION ?? "1.0.0",
    downloadUrl: process.env.APK_DOWNLOAD_URL ?? null,
  });
}
