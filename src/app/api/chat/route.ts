import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { verifyDriverToken } from "@/lib/driverAuth";

// GET /api/chat?driverId=X - fetch chat history
export async function GET(req: NextRequest) {
  try {
    const prisma = getPrisma();
    const driverAuth = verifyDriverToken(req);
    const driverId = req.nextUrl.searchParams.get("driverId");

    const where = driverAuth
      ? { driverId: driverAuth.driverId }
      : driverId
        ? { driverId: Number(driverId) }
        : {};

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
        direction: driverAuth
          ? m.direction === "inbound"
            ? "outbound"
            : "inbound"
          : m.direction,
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
