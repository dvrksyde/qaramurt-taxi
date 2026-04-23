import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { prisma } from '../src/lib/prisma';

async function main() {
  const existingGroups = await prisma.vehicleClassGroup.findMany();
  let group = existingGroups[0];
  if (!group) {
    group = await prisma.vehicleClassGroup.create({
      data: { name: 'Основные', sortOrder: 1 },
    });
  }

  const existingClasses = await prisma.vehicleClass.findMany({ orderBy: { id: "asc" } });

  if (existingClasses.length >= 2) {
    await prisma.vehicleClass.update({
      where: { id: existingClasses[0].id },
      data: { name: 'Эконом', isActive: true, sortOrder: 1 }
    });
    await prisma.vehicleClass.update({
      where: { id: existingClasses[1].id },
      data: { name: 'Комфорт', isActive: true, sortOrder: 2 }
    });
    
    // Disable the rest
    for (let i = 2; i < existingClasses.length; i++) {
      await prisma.vehicleClass.update({
        where: { id: existingClasses[i].id },
        data: { isActive: false }
      });
    }
  } else if (existingClasses.length === 1) {
    await prisma.vehicleClass.update({
      where: { id: existingClasses[0].id },
      data: { name: 'Эконом', isActive: true, sortOrder: 1 }
    });
    await prisma.vehicleClass.create({
      data: { groupId: group.id, name: 'Комфорт', sortOrder: 2, isActive: true }
    });
  } else {
    await prisma.vehicleClass.createMany({
      data: [
        { groupId: group.id, name: 'Эконом', sortOrder: 1, isActive: true },
        { groupId: group.id, name: 'Комфорт', sortOrder: 2, isActive: true },
      ]
    });
  }

  console.log("Successfully seeded Economy and Comfort classes!");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
