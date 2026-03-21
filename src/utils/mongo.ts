import { MongoClient } from "mongodb";
import { loadConfig } from "./config.js";

export async function getDB() {
  const config = await loadConfig();

  if (!config.mongoUri) {
    throw new Error("Mongo URI not set");
  }

  const client = new MongoClient(config.mongoUri);
  await client.connect();

  return { db: client.db("gitpilot"), client };
}