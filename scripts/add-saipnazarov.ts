import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.address.create({
    data: {
      name: 'Сайпназаров',
      query: 'Сайпназаров, улица А. Саипназарова',
      fullAddress: 'улица А. Саипназарова, село Карамурт, Сайрамский район, Туркестанская область',
      lat: 42.304339,
      lon: 69.961836,
      synonyms: ['Саипназаров']
    }
  });
  console.log('Successfully added:', result);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
