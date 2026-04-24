const fs = require('fs');
let code = fs.readFileSync('src/app/api/orders/route.ts', 'utf8');

// Ensure redis is imported
if (!code.includes('import { redis }')) {
  code = code.replace(
    'import { checkPermission } from "@/lib/permissions";',
    'import { checkPermission } from "@/lib/permissions";\nimport { redis } from "@/lib/redis";'
  );
}

const oldLogic = `        const freeDrivers = await prisma.driver.findMany({
          where: { 
            status: "free", 
            currentLocation: { not: null },
            balance: { gte: 30 },
            ...(order.classId ? {
              vehicles: {
                some: {
                  isActive: true,
                  classes: { some: { classId: order.classId } }
                }
              }
            } : {})
          },
          select: { id: true, currentLocation: true }
        });

        const CLOSE_RADIUS_KM = 2.5; // Первая волна (ближайшие)
        const MAX_RADIUS_KM = 5.0; // Вторая волна

        const driversWithDist = freeDrivers
          .map((d) => {
            const loc = parseWkt(d.currentLocation!);
            if (!pickup || !loc) return null;
            return { id: d.id, dist: haversineKm(pickup.lat, pickup.lng, loc.lat, loc.lng) };
          })
          .filter((d): d is { id: number; dist: number } => d !== null && d.dist <= MAX_RADIUS_KM);

        const closeDrivers = driversWithDist.filter((d) => d.dist <= CLOSE_RADIUS_KM);
        const farDrivers = driversWithDist.filter((d) => d.dist > CLOSE_RADIUS_KM);`;

const newLogic = `        const CLOSE_RADIUS_KM = 2.5; // Первая волна (ближайшие)
        const MAX_RADIUS_KM = 5.0; // Вторая волна

        let closeDrivers: {id: number, dist: number}[] = [];
        let farDrivers: {id: number, dist: number}[] = [];

        if (pickup) {
          const nearbyDriverMembers = await redis.geoSearchWith(
            "driver_locations", 
            { longitude: pickup.lng, latitude: pickup.lat },
            { radius: MAX_RADIUS_KM, unit: "km" },
            ["WITHDIST", "ASC"]
          ) as { member: string, distance: number }[];

          const nearbyDriverIds = nearbyDriverMembers.map(d => Number(d.member));

          if (nearbyDriverIds.length > 0) {
            const validDrivers = await prisma.driver.findMany({
              where: { 
                id: { in: nearbyDriverIds },
                status: "free", 
                balance: { gte: 30 },
                ...(order.classId ? {
                  vehicles: {
                    some: {
                      isActive: true,
                      classes: { some: { classId: order.classId } }
                    }
                  }
                } : {})
              },
              select: { id: true }
            });

            const validDriverIds = new Set(validDrivers.map(d => d.id));

            const validWithDist = nearbyDriverMembers
              .filter(d => validDriverIds.has(Number(d.member)))
              .map(d => ({ id: Number(d.member), dist: d.distance }));

            closeDrivers = validWithDist.filter((d) => d.dist <= CLOSE_RADIUS_KM);
            farDrivers = validWithDist.filter((d) => d.dist > CLOSE_RADIUS_KM);
          }
        }`;

// Replace exact lines using regex to avoid whitespace issues
// Because regex dotall is tricky in older Node.js, we just split by string if possible.
const regex = /const freeDrivers = await prisma\.driver\.findMany\(\{[\s\S]*?const farDrivers = driversWithDist\.filter\(\(d\) => d\.dist > CLOSE_RADIUS_KM\);/m;

code = code.replace(regex, newLogic);

fs.writeFileSync('src/app/api/orders/route.ts', code);
console.log('Patched order route geo search');
