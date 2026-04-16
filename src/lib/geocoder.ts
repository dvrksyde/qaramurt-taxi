import { prisma } from "./prisma";

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

async function findPopularStreetName(officialStreet: string): Promise<string | null> {
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
      if (wordLower.startsWith(popularLower) || popularLower.startsWith(wordLower)) {
        return entry.name;
      }
    }
  }
  return null;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const apiKey = process.env.YANDEX_API_KEY;
  if (!apiKey) return null;

  try {
    const landmarks = await prisma.addressBook.findMany({ where: { isActive: true } });

    let nearest: { name: string; dist: number } | null = null;
    for (const lm of landmarks) {
      const dist = distanceM(lat, lng, Number(lm.latitude), Number(lm.longitude));
      if (dist <= 100 && (!nearest || dist < nearest.dist)) {
        nearest = { name: lm.name, dist };
      }
    }

    if (nearest) {
      return nearest.name;
    }

    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&format=json&geocode=${lng},${lat}&lang=ru_RU&results=1`;
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();

    const geoObject = json.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    if (!geoObject) return null;

    const components = geoObject.metaDataProperty.GeocoderMetaData.Address.Components;
    const officialStreet = components.find((c: any) => c.kind === "street")?.name || "";
    const house = components.find((c: any) => c.kind === "house")?.name || "";

    if (officialStreet) {
      const popularName = await findPopularStreetName(officialStreet);
      if (popularName) {
        return house ? `${popularName}, ${house}` : popularName;
      } else {
        return house ? `${officialStreet}, ${house}` : officialStreet;
      }
    }

    const localityRaw = components.find((c: any) => c.kind === "locality")?.name || "Карамурт";
    return localityRaw.replace(/^[сС]ело\s+/, "");
  } catch (e) {
    console.error("Reverse geocoding error:", e);
    return null;
  }
}
