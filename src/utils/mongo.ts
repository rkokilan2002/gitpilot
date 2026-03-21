import { MongoClient } from "mongodb";
import { loadConfig } from "./config.js";

let client: MongoClient | null = null;

export async function getDB() {
  const config = await loadConfig();

  if (!config.mongoUri) {
    throw new Error("Mongo URI not set");
  }

  if (!client) {
    client = new MongoClient(config.mongoUri);
    await client.connect();
  }

  return client.db("gitpilot");
}