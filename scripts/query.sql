UPDATE "vehicle_classes" SET name = 'Эконом', "isActive" = true, "sortOrder" = 1 WHERE id = (SELECT id FROM "vehicle_classes" ORDER BY id ASC LIMIT 1 OFFSET 0);
UPDATE "vehicle_classes" SET name = 'Комфорт', "isActive" = true, "sortOrder" = 2 WHERE id = (SELECT id FROM "vehicle_classes" ORDER BY id ASC LIMIT 1 OFFSET 1);
UPDATE "vehicle_classes" SET "isActive" = false WHERE id NOT IN (SELECT id FROM "vehicle_classes" ORDER BY id ASC LIMIT 2);
