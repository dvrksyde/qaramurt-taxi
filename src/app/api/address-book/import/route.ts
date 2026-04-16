export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";

// POST /api/address-book/import
// Body: { data: Array<{name, fullName?, latitude, longitude}>, truncate?: boolean }
export async function POST(req: NextRequest) {
  const { allowed, response } = await checkPermission(["admin"]);
  if (!allowed) return response!;

  const body = await req.json();
  const rows: any[] = Array.isArray(body.data) ? body.data : [];
  const truncate: boolean = body.truncate === true;

  if (rows.length === 0) {
    return NextResponse.json({ error: "data array is empty" }, { status: 400 });
  }

  // Validate each row
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.name || isNaN(parseFloat(r.latitude)) || isNaN(parseFloat(r.longitude))) {
      return NextResponse.json({ error: `Row ${i + 1} invalid: need name, latitude, longitude` }, { status: 400 });
    }
  }

  if (truncate) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE address_book RESTART IDENTITY CASCADE`);
  }

  let inserted = 0;
  let skipped = 0;

  for (const r of rows) {
    try {
      await prisma.addressBook.create({
        data: {
          name: String(r.name).trim(),
          fullName: r.fullName ? String(r.fullName).trim() : null,
          latitude: parseFloat(r.latitude),
          longitude: parseFloat(r.longitude),
          isActive: r.isActive !== false,
        },
      });
      inserted++;
    } catch {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, inserted, skipped, total: rows.length });
}
