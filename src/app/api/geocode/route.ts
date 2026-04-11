export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

// Server-side geocoding proxy — keeps the Yandex API key safe on the server
// and avoids CORS/referrer restrictions from the browser.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const apiKey = process.env.YANDEX_API_KEY;  // server-side only (no NEXT_PUBLIC_)
  if (!apiKey) {
    return NextResponse.json({ error: "Geocoder not configured" }, { status: 503 });
  }

  try {
    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&format=json&geocode=${lng},${lat}&lang=ru_RU&results=1`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    const json = await res.json();

    const geoObject = json.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    if (!geoObject) {
      return NextResponse.json({ data: null });
    }

    const metaData = geoObject.metaDataProperty.GeocoderMetaData;
    const components = metaData.Address.Components as { kind: string; name: string }[];

    const localityRaw = components.find((c) => c.kind === "locality")?.name || "Qarамурт";
    const locality = localityRaw.replace(/^[сС]ело\s+/, "");
    const street = components.find((c) => c.kind === "street")?.name;
    const house = components.find((c) => c.kind === "house")?.name;

    let address = locality;
    if (street) address += `, ${street}`;
    if (house) address += `, ${house}`;

    return NextResponse.json({ data: { address, components } });
  } catch (e: any) {
    console.error("Geocode error:", e?.message);
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }
}
