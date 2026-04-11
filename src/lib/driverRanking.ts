import { prisma } from "@/lib/prisma";

export interface DriverRankEntry {
  rank: number;
  ordersCount: number;
}

export function buildDriverRankMap(items: Array<{ id: number; ordersCount: number }>) {
  const sorted = [...items].sort((a, b) => {
    const diff = b.ordersCount - a.ordersCount;
    if (diff !== 0) return diff;
    return a.id - b.id;
  });

  const rankMap = new Map<number, DriverRankEntry>();
  sorted.forEach((item, index) => {
    rankMap.set(item.id, {
      rank: index + 1,
      ordersCount: item.ordersCount,
    });
  });

  return rankMap;
}

export async function getDriverRankMap() {
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    select: {
      id: true,
      _count: {
        select: {
          orders: {
            where: { status: "completed" },
          },
        },
      },
    },
  });

  return buildDriverRankMap(
    drivers.map((driver) => ({
      id: driver.id,
      ordersCount: driver._count.orders || 0,
    })),
  );
}

export async function getDriverRank(driverId: number): Promise<DriverRankEntry> {
  const rankMap = await getDriverRankMap();
  return rankMap.get(driverId) || { rank: 0, ordersCount: 0 };
}
