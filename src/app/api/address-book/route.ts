import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") || "").trim();

    if (query.length < 1) {
      return NextResponse.json({ data: [] });
    }

    // Search ONLY by popular name — fullName is just a display hint, not searchable.
    // Returns up to 12 results, sorted:
    //   1. Names that START WITH the query (e.g. "ма" → "Масжид центр")
    //   2. Names that CONTAIN the query anywhere (e.g. "ма" → "Гагарин мактаб")
    const allMatches = await prisma.addressBook.findMany({
      where: {
        name: { contains: query, mode: "insensitive" },
        isActive: true,
      },
      take: 20,
      orderBy: { name: "asc" },
    });

    // Sort: starts-with first
    const q = query.toLowerCase();
    allMatches.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q);
      const bStarts = b.name.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.localeCompare(b.name, "ru");
    });

    return NextResponse.json({ data: allMatches.slice(0, 12) });
  } catch (error: any) {
    console.error("Error fetching address book:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
