export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Haversine distance in meters
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Try to match an official Yandex street name to a popular name in our address book.
 * Strategy:
 *   1. Split the official street name into words (ignore short words < 4 chars)
 *   2. For each word, check if any address book name is a prefix of that word
 *      e.g. "Полатов" is a prefix of "Полатовы" → match!
 *      e.g. "Жамбыл"  is a prefix of "Жамбыла"  → match!
 */
async function findPopularStreetName(officialStreet: string): Promise<string | null> {
  // Get all active address book entries
  const allEntries = await prisma.addressBook.findMany({
    where: { isActive: true },
    select: { name: true },
  });

  const words = officialStreet
    .split(/[\s,\-–]+/)
    .filter((w) => w.length >= 4);

  for (const word of words) {
    const wordLower = word.toLowerCase();
    for (const entry of allEntries) {
      const popularLower = entry.name.toLowerCase();
      // popular name is a prefix of the official word (e.g. "полатов" ⊂ "полатовы")
      if (wordLower.startsWith(popularLower) || popularLower.startsWith(wordLower)) {
        return entry.name;
      }
    }
  }
  return null;
}

/**
 * GET /api/geocode?lat=...&lng=...
 *
 * Returns a human-friendly address with the following priority:
 *   1. Nearest landmark (within 100m) → "Гузар кафе" (exact place)
 *   2. Yandex street + find popular street name → "Полатов, 5"
 *   3. Fallback: Yandex official address (trimmed)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const apiKey = process.env.YANDEX_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Geocoder not configured" }, { status: 503 });
  }

  try {
    // ── Step 1: Check nearest landmark (100m radius) ─────────────────────────
    const landmarks = await prisma.addressBook.findMany({ where: { isActive: true } });

    let nearest: { name: string; dist: number } | null = null;
    for (const lm of landmarks) {
      const dist = distanceM(lat, lng, Number(lm.latitude), Number(lm.longitude));
      if (dist <= 100 && (!nearest || dist < nearest.dist)) {
        nearest = { name: lm.name, dist };
      }
    }

    if (nearest) {
      // Exact place hit — return just the popular name, no house number needed
      return NextResponse.json({ data: { address: nearest.name } });
    }

    // ── Step 2: Yandex geocoding ──────────────────────────────────────────────
    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&format=json&geocode=${lng},${lat}&lang=ru_RU&results=1`;
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();

    const geoObject = json.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    if (!geoObject) {
      return NextResponse.json({ data: null });
    }

    const components = geoObject.metaDataProperty.GeocoderMetaData.Address
      .Components as { kind: string; name: string }[];

    const officialStreet = components.find((c) => c.kind === "street")?.name || "";
    const house = components.find((c) => c.kind === "house")?.name || "";

    // ── Step 3: Replace official street name with popular one ─────────────────
    let address: string;

    if (officialStreet) {
      const popularName = await findPopularStreetName(officialStreet);
      if (popularName) {
        // e.g. "Полатов, 5" or just "Полатов" if no house number
        address = house ? `${popularName}, ${house}` : popularName;
      } else {
        // No popular match — show official street stripped of locality suffix
        address = house ? `${officialStreet}, ${house}` : officialStreet;
      }
    } else {
      // No street at all — show locality
      const localityRaw = components.find((c) => c.kind === "locality")?.name || "Карамурт";
      address = localityRaw.replace(/^[сС]ело\s+/, "");
    }

    return NextResponse.json({ data: { address } });
  } catch (e: any) {
    console.error("Geocode error:", e?.message);
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }
}
