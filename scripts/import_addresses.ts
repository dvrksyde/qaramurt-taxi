import 'dotenv/config';
import { getPrisma } from "../src/lib/prisma";
import * as fs from 'fs';

const prisma = getPrisma();

async function main() {
  if (!fs.existsSync('prisma/addresses.json')) {
    console.log("Файл prisma/addresses.json не найден!");
    process.exit(1);
  }

  const fileData = fs.readFileSync('prisma/addresses.json', 'utf8');
  const addresses = JSON.parse(fileData);

  console.log(`Найдено ${addresses.length} адресов для импорта. Очистка и импорт...`);

  // Clear existing
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE address_book RESTART IDENTITY CASCADE`);

  let count = 0;
  for (const item of addresses) {
    try {
      await prisma.addressBook.create({
        data: {
          name: item.name,
          fullName: item.fullName,
          latitude: parseFloat(item.latitude),
          longitude: parseFloat(item.longitude),
          isActive: item.isActive !== false,
        }
      });
      count++;
    } catch(e) {
      console.error(`Ошибка при добавлении ${item.name}:`, e);
    }
  }

  console.log(`✅ Успешно добавлено ${count} адресов в новую базу данных!`);
}

main()
  .catch((e) => {
    console.error("Ошибка при импорте:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
