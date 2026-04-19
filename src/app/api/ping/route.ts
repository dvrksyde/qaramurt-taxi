import { NextResponse } from "next/server";

// Keep-alive endpoint — prevents Render free tier from sleeping
// Call this every 10 minutes from an external cron service (e.g. cron-job.org)
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
