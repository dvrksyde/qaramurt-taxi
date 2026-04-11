const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clean() {
  try {
    const d = await prisma.driver.deleteMany({
      where: { 
        OR: [
          { phone: '+77066290405' },
          { login: '7066290405' },
          { login: 'dr221' }
        ]
      }
    });
    console.log('Deleted', d.count, 'drivers');
  } catch (e) {
    if (e.code === 'P2003') {
       console.log('Prisma Error: Foreign Key Restrict. Attempting to delete dependent records first or ignoring...');
    }
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

clean();
