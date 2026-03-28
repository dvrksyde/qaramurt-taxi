-- PostGIS extension (already enabled in postgis/postgis image)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Add spatial columns after Prisma creates tables
-- Run this after: npx prisma db push

-- Upgrade geozones.polygon from TEXT to PostGIS GEOMETRY
ALTER TABLE geozones
  ALTER COLUMN polygon TYPE geometry(POLYGON, 4326)
  USING ST_GeomFromText(polygon, 4326);
CREATE INDEX IF NOT EXISTS geozones_polygon_gist ON geozones USING GIST(polygon);

-- Upgrade drivers.current_location to GEOMETRY POINT
ALTER TABLE drivers
  ALTER COLUMN current_location TYPE geometry(POINT, 4326)
  USING ST_GeomFromText(current_location, 4326);
CREATE INDEX IF NOT EXISTS drivers_location_gist ON drivers USING GIST(current_location);

-- Upgrade orders pickup/dropoff to GEOMETRY POINT
ALTER TABLE orders
  ALTER COLUMN pickup_point TYPE geometry(POINT, 4326)
  USING ST_GeomFromText(pickup_point, 4326);
ALTER TABLE orders
  ALTER COLUMN dropoff_point TYPE geometry(POINT, 4326)
  USING ST_GeomFromText(dropoff_point, 4326);
CREATE INDEX IF NOT EXISTS orders_pickup_gist ON orders USING GIST(pickup_point);
CREATE INDEX IF NOT EXISTS orders_dropoff_gist ON orders USING GIST(dropoff_point);

-- Upgrade queues.center_point to GEOMETRY POINT
ALTER TABLE queues
  ALTER COLUMN center_point TYPE geometry(POINT, 4326)
  USING ST_GeomFromText(center_point, 4326);

-- ─── SEED DATA ────────────────────────────────────────────────────────────────

-- Vehicle Class Groups
INSERT INTO vehicle_class_groups (name, sort_order) VALUES
  ('Легковые', 1),
  ('Грузовые', 2)
ON CONFLICT DO NOTHING;

-- Vehicle Classes
INSERT INTO vehicle_classes (group_id, name, sort_order) VALUES
  (1, 'Эконом', 1),
  (1, 'Комфорт', 2),
  (1, 'Бизнес', 3),
  (1, 'VIP', 4),
  (1, 'Минивэн', 5),
  (2, 'до 300 кг', 1),
  (2, 'Газель', 2),
  (2, 'Грузовик', 3)
ON CONFLICT DO NOTHING;

-- Vehicle Options
INSERT INTO vehicle_options (name, description, price_modifier) VALUES
  ('Детское кресло', 'Child safety seat', 50),
  ('Перевозка животных', 'Pet transport', 100),
  ('Некурящий', 'Non-smoking vehicle', 0),
  ('Кондиционер', 'Air conditioning', 0),
  ('Трансфер', 'Airport/hotel transfer', 200)
ON CONFLICT DO NOTHING;

-- Taxi Service
INSERT INTO taxi_services (name, priority, settlement, auto_selection_type) VALUES
  ('QaramurtTaxi', 1, 'Qaramurt', 'nearest')
ON CONFLICT DO NOTHING;

-- Default Tariffs (Economy + Comfort for QaramurtTaxi)
INSERT INTO tariffs (service_id, class_id, name, base_price, price_per_km, price_per_min, min_price, free_wait_minutes, extra_wait_price)
VALUES
  (1, 1, 'Эконом Стандарт', 80, 15.00, 3.00, 150, 5, 5.00),
  (1, 2, 'Комфорт',         120, 20.00, 5.00, 200, 5, 7.00),
  (1, 3, 'Бизнес',          200, 30.00, 8.00, 350, 7, 10.00),
  (1, 4, 'VIP',             400, 50.00, 15.00, 600, 10, 15.00),
  (1, 5, 'Минивэн',         250, 25.00, 6.00, 400, 5, 8.00)
ON CONFLICT DO NOTHING;

-- Driver Tariff Groups
INSERT INTO driver_tariff_groups (name, type, value, description) VALUES
  ('Стандартная комиссия', 'commission', 20, '20% от стоимости заказа'),
  ('Безлимит - Дневная смена', 'unlimited', 500, '500 руб/смена, все заказы включены'),
  ('Безлимит - Ночная смена', 'unlimited', 350, '350 руб/ночную смену')
ON CONFLICT DO NOTHING;

-- Default Admin Operator (password: admin123 - bcrypt hash)
INSERT INTO operators (login, name, password_hash, role, advance_balance) VALUES
  ('admin', 'Администратор', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 100),
  ('hanewex715', 'Главный Оператор', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 100)
ON CONFLICT (login) DO NOTHING;
