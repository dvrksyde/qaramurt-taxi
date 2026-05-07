#!/bin/bash
# One-time OSRM data setup for Kazakhstan.
# Run this once on the server before starting docker-compose.
#
# Usage:
#   cd osrm
#   chmod +x init.sh
#   ./init.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
PBF="$DATA_DIR/kazakhstan-latest.osm.pbf"
OSM_URL="https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf"

mkdir -p "$DATA_DIR"

# 1. Download OSM data (~60 MB)
if [ ! -f "$PBF" ]; then
  echo "[1/4] Downloading Kazakhstan OSM data..."
  wget -O "$PBF" "$OSM_URL"
else
  echo "[1/4] OSM data already exists, skipping download."
fi

# 2. Extract road network
echo "[2/4] Extracting road network (car profile)..."
docker run --rm \
  -v "$DATA_DIR:/data" \
  osrm/osrm-backend:latest \
  osrm-extract -p /opt/car.lua /data/kazakhstan-latest.osm.pbf

# 3. Partition (MLD algorithm)
echo "[3/4] Partitioning..."
docker run --rm \
  -v "$DATA_DIR:/data" \
  osrm/osrm-backend:latest \
  osrm-partition /data/kazakhstan-latest.osrm

# 4. Customize (MLD algorithm)
echo "[4/4] Customizing..."
docker run --rm \
  -v "$DATA_DIR:/data" \
  osrm/osrm-backend:latest \
  osrm-customize /data/kazakhstan-latest.osrm

echo ""
echo "Done! Start OSRM with:"
echo "  docker compose up -d"
echo ""
echo "Test it with:"
echo "  curl 'http://localhost:5000/health'"
