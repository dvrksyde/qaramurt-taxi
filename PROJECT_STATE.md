# Qaramurt Taxi — Полное состояние проекта

> Дата: 2 апреля 2026 г.
> Цель: Подготовка к деплою на публичный сервер.

---

## 1. Что это за проект

Система управления такси для небольшого населённого пункта (село/посёлок). Состоит из двух частей:

1. **Панель диспетчера** (Next.js web app) — операторы принимают звонки клиентов и создают заказы
2. **Мобильное приложение водителя** (Expo React Native) — водители принимают заказы, GPS-таксометр считает цену

### Бизнес-процесс
```
Клиент звонит → Диспетчер создаёт заказ (только адрес подачи) →
Все водители на линии видят заказ → Кто первый нажал "Принять" — тот берёт →
Водитель звонит клиенту (уточняет адрес) → Едет → Клиент садится, говорит куда →
GPS-таксометр считает цену в реальном времени → Поездка завершена
```

### Формула цены
```
Итого = 290₸ (посадка) + (расстояние_км × тариф)
Тариф: 80 ₸/км (город) или 110 ₸/км (за город)
Округление: до ближайших 5₸
```

---

## 2. Технологический стек

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Frontend (диспетчер) | Next.js | 16.2.1 |
| Backend | Next.js API Routes + custom server.ts | — |
| Real-time | Socket.io | 4.8.3 |
| Database | PostgreSQL + PostGIS | 16 |
| ORM | Prisma | 7.6.0 |
| Cache/PubSub | Redis (опционально) | 7 |
| Auth (диспетчер) | NextAuth v4 (JWT) | 4.24.13 |
| Auth (водитель) | Custom HMAC-SHA256 tokens | — |
| Password hashing | scrypt (Node.js crypto) | — |
| Mobile app | Expo (React Native) | SDK 54 |
| Maps (mobile) | react-native-maps + Yandex tiles | — |
| State (mobile) | Zustand | 5.0.12 |
| Контейнеры | Docker + docker-compose | — |

---

## 3. Структура проекта

```
QaramurtTaxi/
├── prisma/
│   └── schema.prisma          # БД-схема (497 строк, 20+ моделей)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/          # NextAuth endpoint
│   │   │   ├── driver/        # API для мобильного приложения
│   │   │   │   ├── auth/      # POST — логин водителя
│   │   │   │   ├── profile/   # GET — профиль + статистика
│   │   │   │   ├── status/    # PATCH — на линии/вне линии
│   │   │   │   ├── location/  # POST — обновление GPS
│   │   │   │   └── orders/
│   │   │   │       ├── current/       # GET — текущий заказ
│   │   │   │       ├── history/       # GET — история
│   │   │   │       └── [id]/
│   │   │   │           ├── accept/    # POST — принять заказ
│   │   │   │           └── status/    # PATCH — arrived/in_progress/completed
│   │   │   ├── orders/        # CRUD заказов (диспетчер)
│   │   │   ├── drivers/       # CRUD водителей
│   │   │   ├── operators/     # CRUD операторов
│   │   │   ├── clients/       # CRUD клиентов
│   │   │   ├── services/      # Службы такси
│   │   │   ├── tariffs/       # Тарифы
│   │   │   ├── tariff-groups/ # Тарифные группы водителей
│   │   │   ├── vehicle-classes/ # Классы авто
│   │   │   ├── vehicle-options/ # Опции авто
│   │   │   ├── vehicles/      # Транспорт
│   │   │   ├── geozones/      # Геозоны
│   │   │   ├── billing/       # Финансы
│   │   │   ├── calls/         # Журнал звонков
│   │   │   ├── admissions/    # Допуски
│   │   │   └── test/          # Тестовый endpoint
│   │   ├── login/             # Страница входа (диспетчер)
│   │   ├── monitor/           # Монитор заказов
│   │   ├── journal/           # Журнал
│   │   ├── clients/           # Клиенты
│   │   └── layout.tsx         # Root layout
│   ├── components/
│   │   ├── layout/            # TopNav, Sidebar
│   │   ├── orders/            # NewOrderModal
│   │   └── drivers/           # DriverForm
│   └── lib/
│       ├── auth.ts            # NextAuth config (scrypt passwords, auto-rehash)
│       ├── driverAuth.ts      # HMAC-SHA256 driver JWT (30-day expiry)
│       ├── passwords.ts       # scrypt hash + verify (with legacy plain-text migration)
│       ├── permissions.ts     # Permission check middleware
│       ├── operatorAccess.ts  # Operator access helper
│       ├── prisma.ts          # Prisma singleton (PrismaPg adapter)
│       ├── pricing.ts         # Price calculation + haversine
│       └── geo.ts             # Geo utilities
├── driver-app/                # Expo mobile app
│   ├── app/
│   │   ├── _layout.tsx        # Root layout with auth guard
│   │   ├── login.tsx          # Login screen
│   │   ├── index.tsx          # Main screen (740 строк)
│   │   │                      # - Online/offline toggle
│   │   │                      # - Order alert modal (30s timer)
│   │   │                      # - Active order view + GPS meter
│   │   │                      # - Yandex map tiles
│   │   │                      # - Bottom nav bar
│   │   ├── history.tsx        # Order history (today/week/all)
│   │   └── chat.tsx           # Real-time chat with dispatcher
│   ├── services/
│   │   ├── api.ts             # HTTP client + SecureStore token
│   │   ├── socket.ts          # Socket.io client
│   │   └── notifications.ts   # Push notifications (expo-notifications)
│   ├── stores/
│   │   └── driverStore.ts     # Zustand state (profile, orders, trip meter)
│   ├── app.json               # Expo config (permissions, plugins)
│   └── package.json           # Expo dependencies
├── server.ts                  # Custom HTTP server (Socket.io + Next.js)
├── server.js                  # Compiled version of server.ts
├── docker-compose.yml         # PostgreSQL + Redis + App
├── Dockerfile                 # Node.js 20 Alpine
├── .env                       # Environment variables (НЕ коммитить!)
├── next.config.ts             # Next.js config
├── tsconfig.json              # TypeScript config
└── tsconfig.server.json       # TypeScript config for server.ts
```

---

## 4. База данных (Prisma Schema)

### Основные модели:
- **Operator** — диспетчеры/админы (login, passwordHash, role, permissions JSON)
- **Driver** — водители (login, passwordHash, status, currentLocation WKT, balance, rating)
- **Client** — клиенты (phone unique, bonusBalance, isBlacklisted)
- **Order** — заказы (phone, pickupAddress, pricePerKm, status enum, distanceKm, finalPrice)
- **Vehicle** — машины (plate unique, make, model, color, привязка к водителю)
- **OrderStatusLog** — лог смены статусов заказа
- **CashTransaction** — финансовые операции
- **CallLog** — журнал звонков
- **TaxiService**, **Tariff**, **VehicleClass**, **Geozone** — справочники

### Enums:
- `DriverStatus`: free, busy, offline
- `OrderStatus`: pending, assigned, arrived, in_progress, completed, canceled
- `DistributionMethod`: automatic, broadcast, sequential, map_pick, list_pick
- `TransactionType`: payout, deposit, penalty, bonus

### Индексы:
- orders: status, driverId, operatorId, createdAt
- cash_transactions: operatorId, createdAt

---

## 5. Аутентификация

### Операторы (панель диспетчера):
- NextAuth v4, стратегия JWT
- Пароли: **scrypt** (crypto модуль Node.js)
- Автоматический rehash старых plain-text паролей при логине
- Роли: `admin`, `dispatcher`, `operator`
- Разрешения: хранятся как JSON массив в БД

### Водители (мобильное приложение):
- Custom HMAC-SHA256 token (НЕ стандартный JWT)
- Формат: `base64url(payload).base64url(signature)`
- Срок жизни: 30 дней
- Секрет: тот же `NEXTAUTH_SECRET`
- Пароли: **тоже scrypt** + auto-rehash legacy plain-text

---

## 6. Socket.io (Real-time)

### Архитектура:
```
server.ts → SocketIOServer → /api/socket

Rooms:
  "monitor"          — диспетчерский пульт
  "drivers"          — все водители на линии
  "driver:{id}"      — конкретный водитель

Middleware:
  - Операторы: проверка NextAuth session cookie (decode JWT)
  - Водители: проверка auth.token из handshake

Events (server → client):
  new_order_alert    → drivers     — новый заказ для всех
  order_taken        → drivers     — заказ занят другим водителем
  order_status_change→ monitor     — смена статуса заказа
  driver_online      → monitor     — водитель вышел на линию
  driver_offline     → monitor     — водитель ушёл
  driver_location_update → monitor — GPS координаты
  chat_message       → monitor/driver — сообщение чата
  driver_alarm       → monitor     — SOS от водителя

Events (client → server):
  driver_connect     — подключение водителя (join rooms)
  driver_location_update — GPS обновление
  driver_accept_order — принятие заказа
  order_status_update — смена статуса
  chat_message       — сообщение
  driver_alarm       — SOS
  join_monitor       — подключение к мониторингу
  dispatch_order     — ручная отправка заказа
  request_counts     — счётчики вкладок
```

---

## 7. Docker конфигурация

### docker-compose.yml:
- **db**: `postgis/postgis:16-3.4`, порт 5433→5432, volume pgdata
- **redis**: `redis:7-alpine`, порт 6379, volume redisdata
- **app**: собирается из Dockerfile, порт 3000

### Dockerfile:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
```

---

## 8. Текущие переменные окружения (.env)

```env
DATABASE_URL="postgresql://qaramurt:qaramurt_pass@localhost:5433/qaramurt_taxi?schema=public"
NEXTAUTH_SECRET="mening-maxfiy-kalitim-123"
NEXTAUTH_URL="http://localhost:3000"
REDIS_URL="redis://localhost:6379"
NODE_ENV="development"
```

---

## 9. NPM Scripts

```json
"dev": "ts-node --project tsconfig.server.json server.ts"
"build": "next build && tsc -p tsconfig.server.json"
"start": "node server.js"
"start:prod": "node server.js"
"db:push": "prisma db push"
"db:generate": "prisma generate"
"postinstall": "prisma generate"
```

---

## 10. Мобильное приложение (driver-app/)

### Зависимости:
expo ~54, expo-router ~55, expo-location, expo-notifications, expo-secure-store,
socket.io-client, zustand, react-native-maps, @expo/vector-icons,
react-native-safe-area-context, react-native-screens, react-native-gesture-handler

### Экраны:
1. **login.tsx** — логин/пароль → JWT → SecureStore
2. **index.tsx** — главный экран:
   - Профиль + статистика (баланс, рейтинг, заказы за сегодня)
   - Кнопка "ВЫЙТИ НА ЛИНИЮ" / "УЙТИ С ЛИНИИ"
   - Яндекс карта (UrlTile) при ожидании
   - Modal нового заказа с таймером 30 сек
   - Экран активного заказа (кнопка звонка, статусы, GPS-счётчик)
   - SOS кнопка
   - Bottom nav: Главная / История / Чат / Выход
3. **history.tsx** — история заказов (сегодня/неделя/все), earnings summary
4. **chat.tsx** — чат с диспетчером через Socket.io

### GPS-таксометр (в index.tsx):
- `expo-location.watchPositionAsync` (accuracy: High, distanceInterval: 20m)
- Haversine формула для расчёта расстояния
- Цена = roundTo5(290 + distance × pricePerKm)
- Обновляет Zustand store → UI рендерит в реальном времени

### API клиент (services/api.ts):
- Автоопределение IP через `Constants.expoConfig.hostUri`
- Token в SecureStore
- Bearer auth в заголовках

---

## 11. КРИТИЧЕСКИЕ ПРОБЛЕМЫ ДЛЯ ПРОДАКШЕНА

### 🔴 SECURITY

1. **NEXTAUTH_SECRET** в .env — слабый ключ `mening-maxfiy-kalitim-123`. Нужен крипто-рандомный 32+ символа.

2. **Docker-compose** хардкодит `qaramurt_pass` как пароль к PostgreSQL. На сервере нужно менять.

3. **CORS в Socket.io** (server.ts:147) — origin привязан к `NEXTAUTH_URL`. Нужно добавить домен мобильного приложения или `*` для API-only.

4. **Driver API** (`/api/driver/*`) — нет rate limiting. Водитель может спамить location updates.

5. **.env** файл попадает в Docker image (Dockerfile копирует всё). Нужен `.dockerignore`.

6. **Файлы мусора в корне**: `deleteScript.js`, `test_driver_post.js`, `seed_error.txt`, `dev.err.log`, `dev.out.log`, `.planning/` — не должны попадать на прод.

### 🟡 INFRASTRUCTURE

7. **Dockerfile** не использует multi-stage build — образ содержит devDependencies и исходники.

8. **docker-compose.yml** — нет healthcheck для app service. Нет restart policy. Нет DNS/SSL.

9. **Redis** работает без пароля.

10. **PostgreSQL** порт 5433 открыт наружу — на проде нужно закрыть.

11. **Нет `.dockerignore`** — node_modules, .next, .git попадут в образ.

12. **Нет Prisma migrations** — используется `db push` (нормально для dev, рискованно для прода).

### 🟡 CODE

13. **server.js** (скомпилированный) и **server.ts** (исходник) оба в Git — достаточно только .ts, .js генерируется при build.

14. **driverAuth.js** в src/lib/ — тоже скомпилированная копия, не нужна.

15. **Encoding issue**: в `/api/driver/auth/route.ts` строки 14, 27, 32 — кириллица отображается как `Р›РѕРіРёРЅ` (mojibake). Нужно пересохранить файл в UTF-8.

16. **driver-app API_BASE** использует `Constants.expoConfig.hostUri` — на проде нужно хардкодить реальный домен/IP.

17. **Yandex Map tiles** — используются напрямую без API ключа. Может перестать работать. Нужен ключ.

---

## 12. ЧТО НУЖНО СДЕЛАТЬ ДЛЯ ПРОДАКШЕНА

### Phase A: Безопасность
- [ ] Сгенерировать сильный NEXTAUTH_SECRET (openssl rand -base64 32)
- [ ] Сменить пароль PostgreSQL
- [ ] Добавить пароль Redis
- [ ] Создать `.dockerignore`
- [ ] Убрать test/debug файлы из корня
- [ ] Исправить mojibake в driver/auth/route.ts
- [ ] Заменить CORS origin на реальный домен

### Phase B: Docker/Deployment
- [ ] Multi-stage Dockerfile (builder + runner)
- [ ] Добавить HTTPS (nginx reverse proxy или Caddy)
- [ ] Закрыть порты PostgreSQL/Redis (только internal network)
- [ ] Добавить healthcheck для app service
- [ ] Настроить volume для логов
- [ ] Добавить DRIVER_API_SECRET как отдельную env var

### Phase C: Mobile App
- [ ] Заменить API_BASE на реальный домен сервера
- [ ] Собрать APK через `eas build -p android --profile preview`
- [ ] Зарегистрировать Yandex Maps API key
- [ ] Настроить push notifications сервер (Expo Push Service)

### Phase D: Инициализация данных
- [ ] Создать admin оператора при первом запуске (seed script)
- [ ] Создать тестовую службу, классы авто, тарифы
- [ ] Проверить что db push создаёт все таблицы
