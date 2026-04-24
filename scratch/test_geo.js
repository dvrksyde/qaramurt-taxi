const { createClient } = require("redis");

async function main() {
  const client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
  await client.connect();

  await client.geoAdd("test_geo", { longitude: 13.361389, latitude: 38.115556, member: "Palermo" });
  await client.geoAdd("test_geo", { longitude: 15.087269, latitude: 37.502669, member: "Catania" });

  const res = await client.geoSearchWith("test_geo", { longitude: 15, latitude: 37 }, { radius: 200, unit: "km" }, ["WITHDIST", "ASC"]);
  console.log("GeoSearch Result:", res);

  await client.quit();
}

main().catch(console.error);
