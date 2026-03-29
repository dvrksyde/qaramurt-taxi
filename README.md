# Qaramurt Taxi Dispatch System 🚕

Modern, ERP-grade Taxi Fleet and Dispatch Management SaaS Platform. Built with Next.js 16, Prisma 7, PostgreSQL (PostGIS), Redis, and Socket.io.

## 👥 Local Developer Setup (Jamoa bo'lib ishlash uchun qo'llanma)

Har bir dasturchi o'zining mustaqil ma'lumotlar bazasida (local database) ishlashi kerak. Shunday qilsak qilingan o'zgarishlar va test xatoliklari boshqalarning muhitiga ta'sir qilmaydi.

### Dastlabki talablar (Prerequisites)
Sizning kompyuteringizda quyidagilar o'rnatilgan bo'lishi shart:
- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/en/) (v20+)
- [Docker Desktop](https://www.docker.com/products/docker-desktop)

### 1-Qadam: Kodni olish va kutubxonalarni o'rnatish
```bash
git clone https://github.com/dvrksyde/qaramurt-taxi.git
cd qaramurt-taxi
npm install
```

### 2-Qadam: Muhit (Environment) o'zgaruvchilarini sozlash
Loyiha papkasida `.env` fayl yarating (u GitHubda yo'q). 
Shu faylning ichiga maxsus parollarni kiriting:
```ini
# Asosiy Baza Linki:
DATABASE_URL="postgresql://qaramurt:qaramurt_pass@localhost:5432/qaramurt_taxi?schema=public"

# Xavfsizlik kaliti (o'zingiz xohlagan matn yozing):
NEXTAUTH_SECRET="mening-maxfiy-kalitim-123"
NEXTAUTH_URL="http://localhost:3000"

# Redis (Socket.io uzatishlari uchun)
REDIS_URL="redis://localhost:6379"
```

### 3-Qadam: Docker orqali Local Baza va Redisni yoqish
Docker dasturi yoniqligiga ishonch hosil qilib, terminalda quyidagi kodni yozing:
```bash
docker compose up -d db redis
```
*(Bu komanda PostGIS bazasini va Redisni fonda ishga tushirib beradi)*

### 4-Qadam: Jadvallarni yaratish va Demo ma'lumotlarni yozish
Ma'lumotlar bazasi toza bo'lganligi uchun unga dizaynni (schema) yozib yuklaymiz:
```bash
npm run db:push
```
Undan so'ng ilk Admin akkaunti va tariflarni kiritish uchun Seed scriptni yoqamiz:
```bash
npx tsx prisma/seed.ts
```

### 5-Qadam: Loyihani ishga tushirish (Run Start)
Hammasi tayyor! Loyihangizni sinov (development) rejimida yoqish uchun:
```bash
npm run dev
```

Endi dastur turg'iziladi va brauzer orqali **http://localhost:3000** ga kiring.
> Login: **admin**
> Parol: **admin123**

---

### Yordamchi komandalar 🛠

Agar Bazani tozalamoqchi bo'lsangiz yoki muammo chiqsa (reset):
```bash
npx prisma db push --force-reset
npx tsx prisma/seed.ts
```

Schema bazani ko'z bilan (UI orqali) ko'rish uchun:
```bash
npm run db:studio
```
