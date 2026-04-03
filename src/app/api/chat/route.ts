import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

// GET /api/chat?driverId=X — fetch chat history
export async function GET(req: NextRequest) {
  try {
    const prisma = getPrisma();
    const driverId = req.nextUrl.searchParams.get("driverId");

    const where = driverId ? { driverId: Number(driverId) } : {};

    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 200,
      include: {
        driver: {
          select: { id: true, callsign: true, firstName: true, lastName: true },
        },
      },
    });

    return NextResponse.json({
      data: messages.map((m: any) => ({
        id: m.id,
        from: m.from,
        driverId: m.driverId,
        text: m.text,
        direction: m.direction,
        timestamp: m.createdAt.toISOString(),
        driverName: m.driver
          ? `${m.driver.callsign || ""} ${m.driver.lastName} ${m.driver.firstName}`.trim()
          : null,
      })),
    });
  } catch (err) {
    console.error("[Chat API]", err);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}
