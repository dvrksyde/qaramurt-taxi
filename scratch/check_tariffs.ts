import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const rows = await p.$queryRaw<any[]>`
    SELECT t.id, t.name, t."pricePerKm", t."outOfCityKmRate", t."classId",
           vc.name as class_name, t."serviceId", ts.name as service_name
    FROM tariffs t
    JOIN vehicle_classes vc ON t."classId" = vc.id
    JOIN taxi_services ts ON t."serviceId" = ts.id
    WHERE t."isActive" = true
    ORDER BY t."classId", t."serviceId"
  `;
  console.log(JSON.stringify(rows, null, 2));
}
main().finally(() => p.$disconnect());
