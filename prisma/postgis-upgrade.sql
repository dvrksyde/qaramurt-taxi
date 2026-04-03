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
