#!/bin/sh
# scripts/init-db.sh

echo "Waiting for database to be ready..."
pg_isready -U qaramurt -d qaramurt_taxi -h db -p 5432 -t 15

echo "Running prisma db push (accepting data loss to force schema update)..."
npx prisma db push --accept-data-loss

echo "Running PostGIS spatial columns upgrade..."
psql -U qaramurt -d qaramurt_taxi -h db -f prisma/postgis-upgrade.sql

echo "Running Prisma TypeScript Seeds (inserting initial data)..."
npm run db:seed

echo "Initialization success!"
