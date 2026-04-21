import 'dotenv/config';
import { getPrisma } from "../src/lib/prisma";
import * as fs from 'fs';

const prisma = getPrisma();

async function main() {
  const addresses = await prisma.addressBook.findMany({
    orderBy: { id: 'asc' }
  });
  fs.writeFileSync('prisma/addresses.json', JSON.stringify(addresses, null, 2));
  console.log(`Успешно выгружено ${addresses.length} адресов в файл prisma/addresses.json`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
