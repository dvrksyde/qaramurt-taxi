import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";

    if (query.length < 2) {
      return NextResponse.json({ data: [] });
    }

    const landmarks = await prisma.addressBook.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { fullName: { contains: query, mode: "insensitive" } },
        ],
        isActive: true,
      },
      take: 10,
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ data: landmarks });
  } catch (error: any) {
    console.error("Error fetching address book:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
